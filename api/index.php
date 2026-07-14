<?php
/**
 * TimeLogger API
 *
 * GET  /api/index.php?resource=tasks|settings|events
 * PUT  /api/index.php?resource=tasks|settings|events
 *      Body: 当該 JSON ファイル全体
 *
 * 書き込みは file lock 付きで原子的に置換する。
 * 読み取りは GET、または /data/*.json を直接見てもよい（AI用）。
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ローカル開発（Vite proxy）用。本番では必要に応じて絞る。
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

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (!is_readable($path)) {
        fail(404, 'not found');
    }
    readfile($path);
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

    $fp = fopen($path, 'c+');
    if ($fp === false) {
        fail(500, 'open failed');
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        fail(500, 'lock failed');
    }
    ftruncate($fp, 0);
    rewind($fp);
    $written = fwrite($fp, $out);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    if ($written === false) {
        fail(500, 'write failed');
    }

    echo json_encode(['ok' => true, 'updatedAt' => $decoded['updatedAt']], JSON_UNESCAPED_UNICODE);
    exit;
}

fail(405, 'method not allowed');
