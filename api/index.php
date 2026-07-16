<?php
/**
 * TimeLogger API
 *
 * GET  /api/index.php?resource=tasks|settings|events
 * PUT  /api/index.php?resource=tasks|settings|events
 *      Body: 当該 JSON ファイル全体
 *
 * 書き込みは一時ファイルへ全書き込み後に rename で原子的に置換する。
 * 読み取り・置換は同リソースの .lock で flock 同期する（GET=共有 / PUT=排他）。
 * 読み取りは GET、または /data/*.json を直接見てもよい（AI用）。
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// TODO(本番): Access-Control-Allow-Origin を許可 Origin に限定する。
// 現状はローカル開発（Vite proxy）都合でリクエスト Origin を反射している。
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dataDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
$allowed = ['tasks', 'settings', 'events'];

$resource = $_GET['resource'] ?? '';
if (!in_array($resource, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'invalid resource'], JSON_UNESCAPED_UNICODE);
    exit;
}

$path = $dataDir . DIRECTORY_SEPARATOR . $resource . '.json';
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

$method = $_SERVER['REQUEST_METHOD'];

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

    withResourceLock($lockPath, LOCK_EX, static function () use ($path, $out): void {
        atomicReplace($path, $out);
    });

    echo json_encode(['ok' => true, 'updatedAt' => $decoded['updatedAt']], JSON_UNESCAPED_UNICODE);
    exit;
}

fail(405, 'method not allowed');
