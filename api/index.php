<?php
/**
 * TimeLogger API
 *
 * 口の正本は docs/api.md。ここを変えたらドキュメントも直す。
 *
 * GET  /api/index.php?resource=tasks|settings|events-index
 * PUT  /api/index.php?resource=settings|events-index
 *      tasks は PUT 不可。folder-* / task-* コマンドで書く
 * GET  /api/index.php?resource=events&chunk=2026Q3
 * PUT  /api/index.php?resource=events&chunk=2026Q3
 *      Body: 当該 JSON ファイル全体
 *
 * GET  /api/index.php?resource=now
 *      記録中 1 本（なければ null）と、直前に閉じた 1 本 last、tasks の更新時刻
 * POST /api/index.php?resource=start
 *      Body: { taskId, at? } — 開いている記録を閉じ、同時刻に開始
 * POST /api/index.php?resource=stop
 *      Body: { at?, eventId? } — まだ開いている自分だけを閉じる。既に閉じていたら 409
 * POST /api/index.php?resource=update
 *      Body: { eventId, taskId?, startedAt?, endedAt? } — 1 件の手編集
 * POST /api/index.php?resource=delete
 *      Body: { eventId }
 * POST /api/index.php?resource=add
 *      Body: { taskId, startedAt, endedAt } — 閉じた記録の追加
 * POST /api/index.php?resource=join
 *      Body: { olderId, newerId, at? } — 記録と記録の境（⇔）。at 省略は中点
 *
 * POST /api/index.php?resource=folder-save
 *      Body: { id?, name, color, taskColors? } — id 無しは追加
 *      taskColors は colorRef を持つ（パレット由来の）タスクだけ
 * POST /api/index.php?resource=folder-move
 *      Body: { folderId, dir } — dir は 1 / -1
 * POST /api/index.php?resource=folder-delete
 *      Body: { folderId } — タスクが残っていれば 400
 * POST /api/index.php?resource=task-save
 *      Body: { id?, folderId, name, color, colorRef? } — id 無しは追加
 *      colorRef は { hue:0-4, sat:0-2, light:0-2 } / null（自由指定）
 * POST /api/index.php?resource=task-reorder
 *      Body: { folderId, orderedIds }
 * POST /api/index.php?resource=task-delete
 *      Body: { taskId } — 記録中なら同時に記録も閉じる
 *
 * POST /api/index.php?resource=debug
 *      Body: { level, message, detail? } — data/debug.log に JSONL 追記
 * GET  /api/index.php?resource=debug
 *      data/debug.log 全文（無ければ空）
 *
 * イベントは data/events/{chunk}.json + data/events/index.json。
 * 旧 data/events.json は移行前のバックアップ用（API では読まない）。
 * 書き込みは一時ファイルへ全書き込み後に rename で原子的に置換する。
 * 読み取り・置換は同リソースの .lock で flock 同期する（GET=共有 / PUT=排他）。
 * 読み取りは GET、または /data/*.json を直接見てもよい（AI用）。
 * debug.log も /data/debug.log を直接読める。
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// TODO(本番): Access-Control-Allow-Origin を許可 Origin に限定する。
// 現状はローカル開発（Vite proxy）都合でリクエスト Origin を反射している。
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Methods: GET, PUT, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dataDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
$commands = [
    'now', 'start', 'stop', 'update', 'delete', 'add', 'join',
    'folder-save', 'folder-move', 'folder-delete',
    'task-save', 'task-reorder', 'task-delete',
];
$allowed = array_merge(['tasks', 'settings', 'events', 'events-index', 'debug'], $commands);

$resource = $_GET['resource'] ?? '';
if (!in_array($resource, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid resource'], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($resource === 'debug') {
    $path = $dataDir . DIRECTORY_SEPARATOR . 'debug.log';
} elseif (in_array($resource, $commands, true)) {
    $path = '';
} elseif ($resource === 'events-index') {
    $path = $dataDir . DIRECTORY_SEPARATOR . 'events' . DIRECTORY_SEPARATOR . 'index.json';
} elseif ($resource === 'events') {
    $chunk = $_GET['chunk'] ?? '';
    if (!is_string($chunk) || !preg_match('/^\d{4}Q[1-4]$/', $chunk)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'chunk required (YYYYQn)'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $path = $dataDir . DIRECTORY_SEPARATOR . 'events' . DIRECTORY_SEPARATOR . $chunk . '.json';
} else {
    $path = $dataDir . DIRECTORY_SEPARATOR . $resource . '.json';
}
$lockPath = $path . '.lock';

function fail(int $code, string $message): void
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function nowIso(): string
{
    $dt = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
    return $dt->format('Y-m-d\\TH:i:sP');
}

function nowIsoMs(): string
{
    $dt = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
    return $dt->format('Y-m-d\\TH:i:s.vP');
}

/**
 * リソース単位の flock（.lock ファイル）。
 * $op は LOCK_SH / LOCK_EX。
 *
 * @template T
 * @param callable(): T $fn
 * @return T
 */
function withResourceLock(string $lockPath, int $op, callable $fn): mixed
{
    $lf = fopen($lockPath, 'c+');
    if ($lf === false) {
        fail(500, 'lock open failed');
    }
    if (!flock($lf, $op)) {
        fclose($lf);
        fail(500, 'lock failed');
    }
    try {
        return $fn();
    } finally {
        flock($lf, LOCK_UN);
        fclose($lf);
    }
}

/** fwrite の部分書き込みを検出して、要求バイトをすべて書く */
function writeAll($fp, string $data): void
{
    $len = strlen($data);
    $offset = 0;
    while ($offset < $len) {
        $n = fwrite($fp, substr($data, $offset));
        if ($n === false || $n === 0) {
            fail(500, 'write failed');
        }
        $offset += $n;
    }
}

/** 一時ファイルへ書いてから rename で置換（同一ディレクトリ前提） */
function atomicReplace(string $path, string $data): void
{
    $dir = dirname($path);
    $tmp = $dir . DIRECTORY_SEPARATOR . '.' . basename($path) . '.' . bin2hex(random_bytes(4)) . '.tmp';

    $fp = fopen($tmp, 'wb');
    if ($fp === false) {
        fail(500, 'open tmp failed');
    }
    writeAll($fp, $data);
    if (!fflush($fp)) {
        fclose($fp);
        @unlink($tmp);
        fail(500, 'flush failed');
    }
    fclose($fp);

    // POSIX では既存ファイル上への rename が原子的。
    // Windows では上書き rename 不可のため、先に削除してから rename する。
    if (!@rename($tmp, $path)) {
        if (file_exists($path) && !@unlink($path)) {
            @unlink($tmp);
            fail(500, 'replace failed');
        }
        if (!@rename($tmp, $path)) {
            @unlink($tmp);
            fail(500, 'replace failed');
        }
    }
}

/** debug.log が肥大化したら末尾だけ残す */
function trimDebugLogIfHuge(string $path, int $maxBytes = 512000, int $keepBytes = 256000): void
{
    if (!is_file($path)) {
        return;
    }
    $size = filesize($path);
    if ($size === false || $size <= $maxBytes) {
        return;
    }
    $fp = fopen($path, 'rb');
    if ($fp === false) {
        return;
    }
    $start = max(0, $size - $keepBytes);
    if (fseek($fp, $start) !== 0) {
        fclose($fp);
        return;
    }
    $chunk = stream_get_contents($fp);
    fclose($fp);
    if ($chunk === false) {
        return;
    }
    // 途中行を捨てて行頭から
    $nl = strpos($chunk, "\n");
    if ($nl !== false) {
        $chunk = substr($chunk, $nl + 1);
    }
    atomicReplace($path, $chunk);
}

$method = $_SERVER['REQUEST_METHOD'];

if (in_array($resource, $commands, true)) {
    require __DIR__ . DIRECTORY_SEPARATOR . 'commands.php';
    handleCommand($dataDir, $resource, $method);
    exit;
}

// --- debug: 追記専用ログ（JSONL） ---
if ($resource === 'debug') {
    if ($method === 'GET') {
        withResourceLock($lockPath, LOCK_SH, static function () use ($path): void {
            if (!is_file($path)) {
                // 空ファイルを用意（クライアントが動く前でもログ先を確保）
                $dir = dirname($path);
                if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
                    echo '';
                    return;
                }
                @touch($path);
            }
            if (!is_readable($path)) {
                echo '';
                return;
            }
            $fp = fopen($path, 'rb');
            if ($fp === false) {
                echo '';
                return;
            }
            $raw = stream_get_contents($fp);
            fclose($fp);
            // テキストのまま返す（JSONL）
            header('Content-Type: text/plain; charset=utf-8');
            echo $raw === false ? '' : $raw;
        });
        exit;
    }

    if ($method === 'POST') {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            fail(400, 'empty body');
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            fail(400, 'invalid json');
        }
        $level = $decoded['level'] ?? 'info';
        $message = $decoded['message'] ?? '';
        if (!is_string($level) || !is_string($message) || $message === '') {
            fail(400, 'level/message required');
        }
        if (!in_array($level, ['error', 'warn', 'info'], true)) {
            fail(400, 'invalid level');
        }
        // クライアント時刻よりサーバー時刻を正とする。detail は任意（長大すぎるものは切る）
        $detail = $decoded['detail'] ?? null;
        $detailJson = json_encode($detail, JSON_UNESCAPED_UNICODE);
        if ($detailJson !== false && strlen($detailJson) > 4000) {
            $detail = ['_truncated' => true, 'preview' => substr($detailJson, 0, 500)];
        }
        $msg = is_string($message) ? $message : '';
        if (strlen($msg) > 500) {
            $msg = substr($msg, 0, 500);
        }
        $ua = null;
        if (isset($decoded['ua']) && is_string($decoded['ua'])) {
            $ua = strlen($decoded['ua']) > 300 ? substr($decoded['ua'], 0, 300) : $decoded['ua'];
        }
        $entry = [
            'at' => nowIsoMs(),
            'level' => $level,
            'message' => $msg,
            'detail' => $detail,
            'ua' => $ua,
        ];
        $line = json_encode($entry, JSON_UNESCAPED_UNICODE);
        if ($line === false) {
            fail(500, 'encode failed');
        }
        $line .= "\n";

        withResourceLock($lockPath, LOCK_EX, static function () use ($path, $line): void {
            $dir = dirname($path);
            if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
                fail(500, 'mkdir data failed');
            }
            if (!is_file($path)) {
                @touch($path);
            }
            trimDebugLogIfHuge($path);
            $fp = fopen($path, 'ab');
            if ($fp === false) {
                fail(500, 'open log failed');
            }
            writeAll($fp, $line);
            fflush($fp);
            fclose($fp);
        });

        echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
        exit;
    }

    fail(405, 'method not allowed');
}

if ($method === 'GET') {
    withResourceLock($lockPath, LOCK_SH, static function () use ($path): void {
        if (!is_readable($path)) {
            fail(404, 'not found');
        }
        $fp = fopen($path, 'rb');
        if ($fp === false) {
            fail(404, 'not found');
        }
        $raw = stream_get_contents($fp);
        fclose($fp);
        if ($raw === false) {
            fail(500, 'read failed');
        }
        echo $raw;
    });
    exit;
}

if ($method === 'PUT') {
    if ($resource === 'tasks') {
        fail(405, 'tasks は folder-save / task-save などのコマンドで書きます');
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        fail(400, 'empty body');
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        fail(400, 'invalid json');
    }

    // サーバー側で updatedAt を必ず更新
    $decoded['updatedAt'] = nowIso();
    $out = json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($out === false) {
        fail(500, 'encode failed');
    }
    $out .= "\n";

    $write = static function () use ($lockPath, $path, $out): void {
        withResourceLock($lockPath, LOCK_EX, static function () use ($path, $out): void {
            $dir = dirname($path);
            if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
                fail(500, 'mkdir failed');
            }
            atomicReplace($path, $out);
        });
    };
    if ($resource === 'events' || $resource === 'events-index') {
        require_once __DIR__ . DIRECTORY_SEPARATOR . 'commands.php';
        withResourceLock(commandsLockPath($dataDir), LOCK_EX, $write);
    } else {
        $write();
    }

    echo json_encode(['ok' => true, 'updatedAt' => $decoded['updatedAt']], JSON_UNESCAPED_UNICODE);
    exit;
}

fail(405, 'method not allowed');
