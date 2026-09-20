<?php
/**
 * Wear / PWA 共用コマンド。
 * GET  now
 * POST start|stop|update|delete|add|join            記録
 * POST folder-save|folder-move|folder-delete        フォルダ
 * POST task-save|task-reorder|task-delete           タスク
 */

declare(strict_types=1);

const COMMAND_SNAP_MS = 2 * 60 * 1000;
const COMMAND_MIN_RECORD_MS = 1000;
const COMMAND_FUTURE_GRACE_MS = 60 * 1000;

function commandsLockPath(string $dataDir): string
{
    return $dataDir . DIRECTORY_SEPARATOR . 'events' . DIRECTORY_SEPARATOR . 'commands.lock';
}

function eventsIndexPath(string $dataDir): string
{
    return $dataDir . DIRECTORY_SEPARATOR . 'events' . DIRECTORY_SEPARATOR . 'index.json';
}

function eventsChunkPath(string $dataDir, string $qid): string
{
    return $dataDir . DIRECTORY_SEPARATOR . 'events' . DIRECTORY_SEPARATOR . $qid . '.json';
}

function tasksPath(string $dataDir): string
{
    return $dataDir . DIRECTORY_SEPARATOR . 'tasks.json';
}

function commandIso(DateTimeImmutable $dt): string
{
    $tokyo = $dt->setTimezone(new DateTimeZone('Asia/Tokyo'));
    return $tokyo->format('Y-m-d\\TH:i:s.vP');
}

function commandNow(): DateTimeImmutable
{
    return new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
}

function commandMs(DateTimeImmutable $dt): int
{
    return $dt->getTimestamp() * 1000 + (int) $dt->format('v');
}

function commandMsFromIso(string $iso): int
{
    try {
        return commandMs(new DateTimeImmutable($iso));
    } catch (Exception $e) {
        return 0;
    }
}

function parseCommandAt(mixed $at): DateTimeImmutable
{
    if ($at === null || $at === '') {
        return commandNow();
    }
    if (!is_string($at)) {
        fail(400, '時刻が不正です');
    }
    try {
        $dt = new DateTimeImmutable($at);
    } catch (Exception $e) {
        fail(400, '時刻が不正です');
    }
    $now = commandNow();
    if (commandMs($dt) > commandMs($now) + COMMAND_FUTURE_GRACE_MS) {
        fail(400, '未来の時間には記録を作れません');
    }
    return $dt;
}

function quarterIdFromIso(string $iso): string
{
    if (!preg_match('/^(\d{4})-(\d{2})/', $iso, $m)) {
        fail(400, '時刻が不正です');
    }
    $q = intdiv(((int) $m[2]) - 1, 3) + 1;
    return $m[1] . 'Q' . $q;
}

function currentQuarterId(): string
{
    return quarterIdFromIso(commandNow()->format('Y-m-d'));
}

function newUuid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return sprintf(
        '%s-%s-%s-%s-%s',
        substr($h, 0, 8),
        substr($h, 8, 4),
        substr($h, 12, 4),
        substr($h, 16, 4),
        substr($h, 20, 12),
    );
}

function sortQuarterIds(array $ids): array
{
    $ids = array_values(array_unique($ids));
    usort($ids, static function (string $a, string $b): int {
        if ($a === $b) {
            return 0;
        }
        $ay = (int) substr($a, 0, 4);
        $by = (int) substr($b, 0, 4);
        if ($ay !== $by) {
            return $ay <=> $by;
        }
        return ((int) substr($a, 5)) <=> ((int) substr($b, 5));
    });
    return $ids;
}

function readJsonObject(string $path): ?array
{
    if (!is_readable($path)) {
        return null;
    }
    $fp = fopen($path, 'rb');
    if ($fp === false) {
        return null;
    }
    $raw = stream_get_contents($fp);
    fclose($fp);
    if ($raw === false || $raw === '') {
        return null;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function writeJsonObject(string $path, array $data, string $updatedAt): void
{
    $data['updatedAt'] = $updatedAt;
    $out = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($out === false) {
        fail(500, 'encode failed');
    }
    $out .= "\n";
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        fail(500, 'mkdir failed');
    }
    atomicReplace($path, $out);
}

/** @return array{chunks: string[], current: string, updatedAt: string} */
function loadEventsIndex(string $dataDir): array
{
    $path = eventsIndexPath($dataDir);
    $lock = $path . '.lock';
    $index = withResourceLock($lock, LOCK_SH, static function () use ($path): ?array {
        return readJsonObject($path);
    });
    if ($index === null || !isset($index['chunks']) || !is_array($index['chunks'])) {
        fail(500, '記録の目次がありません');
    }
    $chunks = [];
    foreach ($index['chunks'] as $id) {
        if (is_string($id) && preg_match('/^\d{4}Q[1-4]$/', $id)) {
            $chunks[] = $id;
        }
    }
    $current = is_string($index['current'] ?? null) ? $index['current'] : currentQuarterId();
    $updatedAt = is_string($index['updatedAt'] ?? null) ? $index['updatedAt'] : commandIso(commandNow());
    return ['chunks' => $chunks, 'current' => $current, 'updatedAt' => $updatedAt];
}

/** @return array{events: list<array<string, mixed>>, updatedAt: string} */
function emptyChunk(string $updatedAt): array
{
    return ['events' => [], 'updatedAt' => $updatedAt];
}

/** @return array<string, array{events: list<array<string, mixed>>, updatedAt: string}> */
function loadChunks(string $dataDir, array $ids, string $stamp): array
{
    $out = [];
    foreach ($ids as $id) {
        if (!is_string($id) || !preg_match('/^\d{4}Q[1-4]$/', $id)) {
            continue;
        }
        $path = eventsChunkPath($dataDir, $id);
        $lock = $path . '.lock';
        $file = withResourceLock($lock, LOCK_SH, static function () use ($path, $stamp): array {
            $decoded = readJsonObject($path);
            if ($decoded === null) {
                return emptyChunk($stamp);
            }
            $events = [];
            if (isset($decoded['events']) && is_array($decoded['events'])) {
                foreach ($decoded['events'] as $ev) {
                    if (is_array($ev) && isset($ev['id'])) {
                        $events[] = $ev;
                    }
                }
            }
            $updatedAt = is_string($decoded['updatedAt'] ?? null) ? $decoded['updatedAt'] : $stamp;
            return ['events' => $events, 'updatedAt' => $updatedAt];
        });
        $out[$id] = $file;
    }
    return $out;
}

function loadTasksFile(string $dataDir): array
{
    $path = tasksPath($dataDir);
    $lock = $path . '.lock';
    $file = withResourceLock($lock, LOCK_SH, static function () use ($path): ?array {
        return readJsonObject($path);
    });
    if ($file === null) {
        fail(500, 'タスクがありません');
    }
    return $file;
}

function tasksUpdatedAt(array $tasksFile): string
{
    return is_string($tasksFile['updatedAt'] ?? null) ? $tasksFile['updatedAt'] : '';
}

/** @return list<array<string, mixed>> */
function masterList(array $tasksFile, string $key): array
{
    $rows = [];
    foreach ($tasksFile[$key] ?? [] as $row) {
        if (is_array($row) && is_string($row['id'] ?? null)) {
            $rows[] = $row;
        }
    }
    return $rows;
}

/** @param list<array<string, mixed>> $rows */
function findMasterIndex(array $rows, string $id): int
{
    foreach ($rows as $i => $row) {
        if (($row['id'] ?? null) === $id) {
            return $i;
        }
    }
    return -1;
}

/**
 * sortOrder 昇順。同値は元の並び。
 * @param list<array<string, mixed>> $rows
 * @return list<array<string, mixed>>
 */
function sortedByOrder(array $rows): array
{
    $keyed = [];
    foreach ($rows as $i => $row) {
        $keyed[] = [$i, $row];
    }
    usort($keyed, static function (array $a, array $b): int {
        $ao = is_int($a[1]['sortOrder'] ?? null) ? $a[1]['sortOrder'] : PHP_INT_MAX;
        $bo = is_int($b[1]['sortOrder'] ?? null) ? $b[1]['sortOrder'] : PHP_INT_MAX;
        return $ao === $bo ? $a[0] <=> $b[0] : $ao <=> $bo;
    });
    return array_map(static fn(array $pair): array => $pair[1], $keyed);
}

function requireMasterName(mixed $value): string
{
    if (!is_string($value)) {
        fail(400, '名前が必要です');
    }
    $name = trim($value);
    if ($name === '') {
        fail(400, '名前が必要です');
    }
    // mbstring が無い環境でも文字数で数える
    $len = preg_match_all('/./us', $name);
    if ($len === false ? strlen($name) > 300 : $len > 100) {
        fail(400, '名前が長すぎます');
    }
    return $name;
}

/**
 * タスク色の座標（色相5段 × 彩度3段 × 明暗3段）。
 * 実際の色の算出はパレット描画と同じ TS 側が持つ。ここは形だけ見る。
 */
function requireTaskColorRef(mixed $value): array
{
    if (!is_array($value)) {
        fail(400, 'colorRef が不正です');
    }
    $axes = ['hue' => 5, 'sat' => 3, 'light' => 3];
    $ref = [];
    foreach ($axes as $key => $size) {
        $n = $value[$key] ?? null;
        if (!is_int($n) || $n < 0 || $n >= $size) {
            fail(400, 'colorRef が不正です');
        }
        $ref[$key] = $n;
    }
    return $ref;
}

function requireMasterColor(mixed $value): string
{
    if (!is_string($value) || preg_match('/^#[0-9a-fA-F]{6}$/', $value) !== 1) {
        fail(400, '色が不正です');
    }
    return $value;
}

/**
 * @param list<array<string, mixed>> $folders
 * @param list<array<string, mixed>> $tasks
 */
function saveTasksFile(string $dataDir, array $folders, array $tasks, string $stamp): array
{
    $path = tasksPath($dataDir);
    $payload = ['folders' => array_values($folders), 'tasks' => array_values($tasks)];
    withResourceLock($path . '.lock', LOCK_EX, static function () use ($path, $payload, $stamp): void {
        writeJsonObject($path, $payload, $stamp);
    });
    return $payload + ['updatedAt' => $stamp];
}

function echoTasks(array $tasksFile, array $extra = []): void
{
    echoCommandResult(array_merge(['ok' => true, 'tasks' => $tasksFile], $extra));
}

function findTaskAndFolder(array $tasksFile, string $taskId): array
{
    $task = null;
    foreach ($tasksFile['tasks'] ?? [] as $row) {
        if (is_array($row) && ($row['id'] ?? null) === $taskId) {
            $task = $row;
            break;
        }
    }
    if ($task === null) {
        fail(404, 'タスクが見つかりません');
    }
    $folder = null;
    $folderId = $task['folderId'] ?? '';
    foreach ($tasksFile['folders'] ?? [] as $row) {
        if (is_array($row) && ($row['id'] ?? null) === $folderId) {
            $folder = $row;
            break;
        }
    }
    if ($folder === null) {
        fail(404, 'フォルダが見つかりません');
    }
    return [$task, $folder];
}

/**
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @return array<string, mixed>|null
 */
function findOpenEvent(array $chunks): ?array
{
    $best = null;
    $bestStart = PHP_INT_MIN;
    foreach ($chunks as $file) {
        foreach ($file['events'] as $ev) {
            if (($ev['endedAt'] ?? null) !== null) {
                continue;
            }
            $s = commandMsFromIso((string) ($ev['startedAt'] ?? ''));
            if ($s >= $bestStart) {
                $bestStart = $s;
                $best = $ev;
            }
        }
    }
    return $best;
}

/**
 * @param list<array<string, mixed>> $events
 * @return list<array<string, mixed>>
 */
function closeOrDiscardOpen(array $events, int $endMs, string $endIso, ?string $onlyId): array
{
    $next = [];
    foreach ($events as $ev) {
        if (($ev['endedAt'] ?? null) !== null) {
            $next[] = $ev;
            continue;
        }
        if ($onlyId !== null && ($ev['id'] ?? null) !== $onlyId) {
            $next[] = $ev;
            continue;
        }
        $startMs = commandMsFromIso((string) ($ev['startedAt'] ?? ''));
        $elapsed = $endMs - $startMs;
        if ($startMs <= 0 || $elapsed < COMMAND_MIN_RECORD_MS) {
            continue;
        }
        $ev['endedAt'] = $endIso;
        $ev['updatedAt'] = $endIso;
        $next[] = $ev;
    }
    return $next;
}

/**
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @return array<string, array{events: list<array<string, mixed>>, updatedAt: string}>
 */
function closeOpenAcrossChunks(array $chunks, int $endMs, string $endIso, ?string $onlyId): array
{
    $dirty = [];
    foreach ($chunks as $id => $file) {
        $has = false;
        foreach ($file['events'] as $ev) {
            if (($ev['endedAt'] ?? null) === null && ($onlyId === null || ($ev['id'] ?? null) === $onlyId)) {
                $has = true;
                break;
            }
        }
        if (!$has) {
            continue;
        }
        $dirty[$id] = [
            'events' => closeOrDiscardOpen($file['events'], $endMs, $endIso, $onlyId),
            'updatedAt' => $endIso,
        ];
    }
    return $dirty;
}

/**
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @return array<string, mixed>|null
 */
function lastEndedByStart(array $chunks): ?array
{
    $best = null;
    $bestStart = PHP_INT_MIN;
    foreach ($chunks as $file) {
        foreach ($file['events'] as $ev) {
            if (($ev['endedAt'] ?? null) === null) {
                continue;
            }
            $s = commandMsFromIso((string) ($ev['startedAt'] ?? ''));
            if ($s >= $bestStart) {
                $bestStart = $s;
                $best = $ev;
            }
        }
    }
    return $best;
}

function mergeOverlay(array $chunks, array $dirty): array
{
    $out = $chunks;
    foreach ($dirty as $id => $file) {
        $out[$id] = $file;
    }
    return $out;
}

function persistCommandWrites(string $dataDir, array $index, array $dirtyChunks, string $stamp): array
{
    $cur = currentQuarterId();
    $chunksList = $index['chunks'];
    $changedIndex = false;
    foreach (array_keys($dirtyChunks) as $id) {
        if (!in_array($id, $chunksList, true)) {
            $chunksList[] = $id;
            $changedIndex = true;
        }
    }
    if (!in_array($cur, $chunksList, true)) {
        $chunksList[] = $cur;
        $changedIndex = true;
    }
    if ($index['current'] !== $cur) {
        $changedIndex = true;
    }
    if ($changedIndex) {
        $index = [
            'chunks' => sortQuarterIds($chunksList),
            'current' => $cur,
            'updatedAt' => $stamp,
        ];
        $indexPath = eventsIndexPath($dataDir);
        withResourceLock($indexPath . '.lock', LOCK_EX, static function () use ($indexPath, $index, $stamp): void {
            writeJsonObject($indexPath, $index, $stamp);
        });
    }

    $written = [];
    foreach ($dirtyChunks as $id => $file) {
        $path = eventsChunkPath($dataDir, $id);
        withResourceLock($path . '.lock', LOCK_EX, static function () use ($path, $file, $stamp): void {
            writeJsonObject($path, ['events' => $file['events']], $stamp);
        });
        $written[$id] = ['events' => $file['events'], 'updatedAt' => $stamp];
    }
    return ['index' => $index, 'chunks' => $written];
}

function commandIsoFromMs(int $ms): string
{
    $sec = intdiv($ms, 1000);
    $frac = ($ms % 1000) * 1000;
    if ($frac < 0) {
        $sec -= 1;
        $frac += 1_000_000;
    }
    $dt = DateTimeImmutable::createFromFormat(
        'U.u',
        sprintf('%d.%06d', $sec, $frac),
    );
    if ($dt === false) {
        fail(500, '時刻の計算に失敗しました');
    }
    return commandIso($dt->setTimezone(new DateTimeZone('Asia/Tokyo')));
}

function readJsonBody(bool $required): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        if ($required) {
            fail(400, 'empty body');
        }
        return [];
    }
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        fail(400, 'invalid json');
    }
    return $body;
}

function requireStringId(mixed $value, string $field): string
{
    if (!is_string($value) || $value === '') {
        fail(400, $field . ' required');
    }
    return $value;
}

/** @param array<string, mixed> $ev */
function eventStartMs(array $ev): int
{
    return commandMsFromIso((string) ($ev['startedAt'] ?? ''));
}

/** @param array<string, mixed> $ev */
function eventEndMsOf(array $ev, int $nowMs): int
{
    if (isset($ev['endedAt']) && is_string($ev['endedAt'])) {
        return commandMsFromIso($ev['endedAt']);
    }
    return $nowMs;
}

/**
 * @param list<array<string, mixed>> $events
 * @return list<array<string, mixed>>
 */
function eventsChrono(array $events): array
{
    $list = array_values($events);
    usort($list, static function (array $a, array $b): int {
        return eventStartMs($a) <=> eventStartMs($b);
    });
    return $list;
}

/**
 * @param list<array<string, mixed>> $events
 * @return array{0: array<string, mixed>|null, 1: array<string, mixed>|null}
 */
function findPrevNext(array $events, int $startMs, ?string $excludeId): array
{
    $list = [];
    foreach ($events as $ev) {
        if ($excludeId !== null && ($ev['id'] ?? null) === $excludeId) {
            continue;
        }
        $list[] = $ev;
    }
    $list = eventsChrono($list);
    $prev = null;
    $next = null;
    foreach ($list as $ev) {
        if (eventStartMs($ev) <= $startMs) {
            $prev = $ev;
        } else {
            $next = $ev;
            break;
        }
    }
    return [$prev, $next];
}

/**
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @return list<array<string, mixed>>
 */
function allEvents(array $chunks): array
{
    $out = [];
    foreach ($chunks as $file) {
        foreach ($file['events'] as $ev) {
            $out[] = $ev;
        }
    }
    return $out;
}

/**
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @return array<string, mixed>|null
 */
function findEventById(array $chunks, string $id): ?array
{
    foreach ($chunks as $file) {
        foreach ($file['events'] as $ev) {
            if (($ev['id'] ?? null) === $id) {
                return $ev;
            }
        }
    }
    return null;
}

/** @param array<string, mixed> $ev */
function formatEventRangeShort(array $ev): string
{
    $s = (string) ($ev['startedAt'] ?? '');
    $e = $ev['endedAt'] ?? null;
    $st = preg_match('/T(\d{2}:\d{2}:\d{2})/', $s, $m) === 1 ? $m[1] : $s;
    if (!is_string($e) || $e === '') {
        return $st . ' → …';
    }
    $et = preg_match('/T(\d{2}:\d{2}:\d{2})/', $e, $m2) === 1 ? $m2[1] : $e;
    return $st . ' → ' . $et;
}

function isoOrSnapped(string $original, int $origMs, int $snappedMs): string
{
    return $origMs === $snappedMs ? $original : commandIsoFromMs($snappedMs);
}

/**
 * @param list<array<string, mixed>> $events
 * @return array<string, mixed>|null
 */
function findOverlap(array $events, int $startMs, int $endMs, ?string $excludeId, int $nowMs): ?array
{
    $startSec = intdiv($startMs, 1000);
    $endSec = intdiv($endMs, 1000);
    foreach ($events as $ev) {
        if ($excludeId !== null && ($ev['id'] ?? null) === $excludeId) {
            continue;
        }
        $s = intdiv(eventStartMs($ev), 1000);
        $e = intdiv(eventEndMsOf($ev, $nowMs), 1000);
        if ($startSec < $e && $s < $endSec) {
            return $ev;
        }
    }
    return null;
}

function failOverlap(array $hit): void
{
    $name = is_string($hit['taskName'] ?? null) ? $hit['taskName'] : '';
    fail(400, '既存の記録（' . $name . ' ' . formatEventRangeShort($hit) . '）と時間が重なっています');
}

function assertDuration(int $startMs, int $endMs, string $label): void
{
    if ($endMs - $startMs < COMMAND_MIN_RECORD_MS) {
        fail(400, $label . 'が1秒未満になります');
    }
}

/**
 * @param list<array<string, mixed>> $events
 * @return array{startMs: int, endMs: int|null, patches: list<array<string, mixed>>}
 */
function snapEventTimes(array $events, ?string $excludeId, int $startMs, ?int $endMs, int $nowMs, string $move): array
{
    $patches = [];
    $duration = $endMs !== null ? $endMs - $startMs : PHP_INT_MAX;
    $short = $duration <= COMMAND_SNAP_MS;
    [$prev, $next] = findPrevNext($events, $startMs, $excludeId);
    $snapStart = !$short || $move === 'start' || $move === 'both';
    $snapEnd = !$short || $move === 'end' || $move === 'both';

    if ($prev !== null && isset($prev['endedAt']) && is_string($prev['endedAt'])) {
        $prevEnd = eventEndMsOf($prev, $nowMs);
        $overlap = $startMs < $prevEnd;
        $gap = $startMs > $prevEnd;
        $should = abs($prevEnd - $startMs) <= COMMAND_SNAP_MS && ($overlap || ($gap && $snapStart));
        if ($should) {
            $mid = (int) round(($prevEnd + $startMs) / 2);
            $startMs = $mid;
            $patches[] = ['id' => $prev['id'], 'endedAt' => commandIsoFromMs($mid)];
            assertDuration(eventStartMs($prev), $mid, '前の記録');
        }
    }

    if ($next !== null && $endMs !== null) {
        $nextStart = eventStartMs($next);
        $overlap = $endMs > $nextStart;
        $gap = $endMs < $nextStart;
        $should = abs($endMs - $nextStart) <= COMMAND_SNAP_MS && ($overlap || ($gap && $snapEnd));
        if ($should) {
            $mid = (int) round(($endMs + $nextStart) / 2);
            $endMs = $mid;
            $patches[] = ['id' => $next['id'], 'startedAt' => commandIsoFromMs($mid)];
            if (isset($next['endedAt']) && is_string($next['endedAt'])) {
                assertDuration($mid, eventEndMsOf($next, $nowMs), '次の記録');
            }
        }
    }

    if ($endMs !== null) {
        assertDuration($startMs, $endMs, 'この記録');
    }
    return ['startMs' => $startMs, 'endMs' => $endMs, 'patches' => $patches];
}

/**
 * @param list<array<string, mixed>> $events
 */
function validateEventRange(array $events, int $startMs, int $endMs, ?string $excludeId, int $nowMs, bool $validateEndBound): void
{
    if ($startMs <= 0) {
        fail(400, '開始時刻が不正です');
    }
    if ($validateEndBound) {
        if ($endMs <= 0) {
            fail(400, '終了時刻が不正です');
        }
        if ($endMs <= $startMs) {
            fail(400, '終了は開始より後にしてください');
        }
        if ($endMs - $startMs < COMMAND_MIN_RECORD_MS) {
            fail(400, '1秒未満の記録にはできません');
        }
    }
    if (
        $startMs > $nowMs + COMMAND_FUTURE_GRACE_MS
        || ($validateEndBound && $endMs > $nowMs + COMMAND_FUTURE_GRACE_MS)
    ) {
        fail(400, '未来の時間には記録を作れません');
    }
    $hit = findOverlap($events, $startMs, $endMs, $excludeId, $nowMs);
    if ($hit !== null) {
        failOverlap($hit);
    }
}

/**
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @param list<array<string, mixed>> $events
 * @return array<string, array{events: list<array<string, mixed>>, updatedAt: string}>
 */
function upsertEvents(array $chunks, array $events, string $stamp): array
{
    $byId = [];
    foreach ($events as $ev) {
        $id = $ev['id'] ?? null;
        if (!is_string($id) || $id === '') {
            fail(500, '記録IDがありません');
        }
        $ev['updatedAt'] = $stamp;
        $byId[$id] = $ev;
    }
    $dirty = [];
    foreach ($chunks as $qid => $file) {
        $next = [];
        $changed = false;
        foreach ($file['events'] as $ev) {
            $id = $ev['id'] ?? null;
            if (is_string($id) && isset($byId[$id])) {
                $changed = true;
                continue;
            }
            $next[] = $ev;
        }
        if ($changed) {
            $dirty[$qid] = ['events' => $next, 'updatedAt' => $stamp];
        }
    }
    foreach ($byId as $ev) {
        $qid = quarterIdFromIso((string) $ev['startedAt']);
        $base = $dirty[$qid]['events'] ?? $chunks[$qid]['events'] ?? [];
        $base[] = $ev;
        $dirty[$qid] = ['events' => $base, 'updatedAt' => $stamp];
    }
    return $dirty;
}

/**
 * @param list<array<string, mixed>> $patches
 * @param array<string, mixed> $main
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @return list<array<string, mixed>>
 */
function replacementsFromPatches(array $chunks, array $patches, array $main, string $stamp): array
{
    $out = [];
    foreach ($patches as $p) {
        $id = $p['id'] ?? null;
        if (!is_string($id) || $id === '') {
            continue;
        }
        $orig = findEventById($chunks, $id);
        if ($orig === null) {
            fail(404, '記録が見つかりません');
        }
        if (isset($p['startedAt']) && is_string($p['startedAt'])) {
            $orig['startedAt'] = $p['startedAt'];
        }
        if (array_key_exists('endedAt', $p)) {
            $orig['endedAt'] = $p['endedAt'];
        }
        $orig['updatedAt'] = $stamp;
        $out[] = $orig;
    }
    $main['updatedAt'] = $stamp;
    $out[] = $main;
    return $out;
}

/**
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $chunks
 * @param array<string, array{events: list<array<string, mixed>>, updatedAt: string}> $written
 */
function echoCommandWrite(array $tasks, array $index, array $chunks, array $written, array $extra = []): void
{
    $overlay = mergeOverlay($chunks, $written['chunks']);
    echoCommandResult(array_merge([
        'ok' => true,
        'current' => findOpenEvent($overlay),
        'last' => lastEndedByStart($overlay),
        'tasksUpdatedAt' => tasksUpdatedAt($tasks),
        'index' => $written['index'],
        'chunks' => $written['chunks'],
    ], $extra));
}

function echoCommandResult(array $payload): void
{
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
}

function handleNow(string $dataDir): void
{
    $tasks = loadTasksFile($dataDir);
    $stamp = commandIso(commandNow());
    $index = loadEventsIndex($dataDir);
    $ids = array_reverse($index['chunks']);
    $current = null;
    $last = null;
    foreach ($ids as $id) {
        $chunks = loadChunks($dataDir, [$id], $stamp);
        if ($current === null) {
            $current = findOpenEvent($chunks);
        }
        if ($last === null) {
            $last = lastEndedByStart($chunks);
        }
        if ($current !== null && $last !== null) {
            break;
        }
    }
    echoCommandResult([
        'ok' => true,
        'current' => $current,
        'last' => $last,
        'tasksUpdatedAt' => tasksUpdatedAt($tasks),
    ]);
}

function handleStart(string $dataDir): void
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        fail(400, 'empty body');
    }
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        fail(400, 'invalid json');
    }
    $taskId = $body['taskId'] ?? '';
    if (!is_string($taskId) || $taskId === '') {
        fail(400, 'taskId required');
    }
    $at = parseCommandAt($body['at'] ?? null);
    $endMs = commandMs($at);
    $stamp = commandIso($at);

    $tasks = loadTasksFile($dataDir);
    [$task, $folder] = findTaskAndFolder($tasks, $taskId);

    $index = loadEventsIndex($dataDir);
    $chunks = loadChunks($dataDir, $index['chunks'], $stamp);
    $dirty = closeOpenAcrossChunks($chunks, $endMs, $stamp, null);
    $overlay = mergeOverlay($chunks, $dirty);

    $startIso = $stamp;
    $lastEnded = lastEndedByStart($overlay);
    if ($lastEnded !== null && is_string($lastEnded['endedAt'] ?? null)) {
        $lastEnd = commandMsFromIso($lastEnded['endedAt']);
        if ($lastEnd !== $endMs && abs($endMs - $lastEnd) <= COMMAND_SNAP_MS) {
            $mid = (int) round(($lastEnd + $endMs) / 2);
            $midDt = DateTimeImmutable::createFromFormat(
                'U.u',
                sprintf('%d.%06d', intdiv($mid, 1000), ($mid % 1000) * 1000),
            );
            if ($midDt === false) {
                fail(500, '時刻の計算に失敗しました');
            }
            $startIso = commandIso($midDt->setTimezone(new DateTimeZone('Asia/Tokyo')));
            $lastId = $lastEnded['id'] ?? null;
            foreach ($overlay as $qid => $file) {
                $changed = false;
                foreach ($file['events'] as $i => $ev) {
                    if (($ev['id'] ?? null) === $lastId) {
                        $file['events'][$i]['endedAt'] = $startIso;
                        $file['events'][$i]['updatedAt'] = $stamp;
                        $changed = true;
                    }
                }
                if ($changed) {
                    $file['updatedAt'] = $stamp;
                    $overlay[$qid] = $file;
                    $dirty[$qid] = $file;
                }
            }
        }
    }

    $started = [
        'id' => newUuid(),
        'taskId' => $task['id'],
        'folderId' => $folder['id'],
        'taskName' => $task['name'],
        'folderName' => $folder['name'],
        'taskColor' => $task['color'],
        'folderColor' => $folder['color'],
        'startedAt' => $startIso,
        'endedAt' => null,
        'createdAt' => $stamp,
        'updatedAt' => $stamp,
    ];
    $qid = quarterIdFromIso($startIso);
    $base = $overlay[$qid]['events'] ?? [];
    $base[] = $started;
    $dirty[$qid] = ['events' => $base, 'updatedAt' => $stamp];

    $written = persistCommandWrites($dataDir, $index, $dirty, $stamp);
    echoCommandWrite($tasks, $index, $chunks, $written);
}

function handleStop(string $dataDir): void
{
    $raw = file_get_contents('php://input');
    $body = [];
    if ($raw !== false && $raw !== '') {
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            fail(400, 'invalid json');
        }
        $body = $decoded;
    }
    $eventId = $body['eventId'] ?? null;
    if ($eventId !== null && !is_string($eventId)) {
        fail(400, 'eventId が不正です');
    }
    $at = parseCommandAt($body['at'] ?? null);
    $endMs = commandMs($at);
    $stamp = commandIso($at);

    $tasks = loadTasksFile($dataDir);
    $index = loadEventsIndex($dataDir);
    $chunks = loadChunks($dataDir, $index['chunks'], $stamp);

    if ($eventId !== null) {
        $found = null;
        foreach ($chunks as $file) {
            foreach ($file['events'] as $ev) {
                if (($ev['id'] ?? null) === $eventId) {
                    $found = $ev;
                    break 2;
                }
            }
        }
        if ($found === null) {
            fail(404, '記録が見つかりません');
        }
        if (($found['endedAt'] ?? null) !== null) {
            fail(409, '既に終了しています');
        }
    } else {
        $open = findOpenEvent($chunks);
        if ($open === null) {
            echoCommandResult([
                'ok' => true,
                'current' => null,
                'last' => lastEndedByStart($chunks),
                'tasksUpdatedAt' => tasksUpdatedAt($tasks),
                'index' => $index,
                'chunks' => new stdClass(),
            ]);
            return;
        }
    }

    $dirty = closeOpenAcrossChunks($chunks, $endMs, $stamp, $eventId);
    if ($dirty === []) {
        echoCommandResult([
            'ok' => true,
            'current' => null,
            'last' => lastEndedByStart($chunks),
            'tasksUpdatedAt' => tasksUpdatedAt($tasks),
            'index' => $index,
            'chunks' => new stdClass(),
        ]);
        return;
    }
    $written = persistCommandWrites($dataDir, $index, $dirty, $stamp);
    echoCommandWrite($tasks, $index, $chunks, $written);
}

function handleUpdate(string $dataDir): void
{
    $body = readJsonBody(true);
    $eventId = requireStringId($body['eventId'] ?? null, 'eventId');
    $taskIdIn = $body['taskId'] ?? null;
    if ($taskIdIn !== null && !is_string($taskIdIn)) {
        fail(400, 'taskId が不正です');
    }
    if (array_key_exists('startedAt', $body) && $body['startedAt'] !== null && !is_string($body['startedAt'])) {
        fail(400, '時刻が不正です');
    }
    if (array_key_exists('endedAt', $body) && $body['endedAt'] !== null && !is_string($body['endedAt'])) {
        fail(400, '時刻が不正です');
    }

    $stampNow = commandNow();
    $nowMs = commandMs($stampNow);
    $stamp = commandIso($stampNow);

    $tasks = loadTasksFile($dataDir);
    $index = loadEventsIndex($dataDir);
    $chunks = loadChunks($dataDir, $index['chunks'], $stamp);
    $prev = findEventById($chunks, $eventId);
    if ($prev === null) {
        fail(404, '記録が見つかりません');
    }

    $taskId = is_string($taskIdIn) && $taskIdIn !== '' ? $taskIdIn : (string) ($prev['taskId'] ?? '');
    [$task, $folder] = findTaskAndFolder($tasks, $taskId);

    $startedAtRaw = is_string($body['startedAt'] ?? null) ? $body['startedAt'] : (string) $prev['startedAt'];
    $startDt = parseCommandAt($startedAtRaw);
    $startMs = commandMs($startDt);
    $startedAtKeep = $startedAtRaw;

    $prevOpen = ($prev['endedAt'] ?? null) === null;
    $endedAtProvided = array_key_exists('endedAt', $body);
    $endedAtIn = $endedAtProvided ? $body['endedAt'] : null;
    $validateEndBound = false;
    $endMs = $nowMs;
    $endedAtKeep = null;
    if ($prevOpen) {
        if ($endedAtProvided && is_string($endedAtIn)) {
            fail(400, '記録中の終了時刻は編集できません');
        }
        $endedAtIso = null;
    } else {
        if ($endedAtProvided && $endedAtIn === null) {
            fail(400, '終了済みの記録を記録中には戻せません');
        }
        $endedAtKeep = is_string($endedAtIn) ? $endedAtIn : (string) $prev['endedAt'];
        $endDt = parseCommandAt($endedAtKeep);
        $endMs = commandMs($endDt);
        $validateEndBound = true;
    }

    $move = 'both';
    $oldS = eventStartMs($prev);
    $oldE = $prevOpen ? null : eventEndMsOf($prev, $nowMs);
    $startCh = $startMs !== $oldS;
    $endCh = !$prevOpen && $oldE !== null && $endMs !== $oldE;
    if ($startCh && !$endCh) {
        $move = 'start';
    } elseif (!$startCh && $endCh) {
        $move = 'end';
    }

    $snapped = snapEventTimes(
        allEvents($chunks),
        $eventId,
        $startMs,
        $prevOpen ? null : $endMs,
        $nowMs,
        $move,
    );
    $startMs = $snapped['startMs'];
    if ($snapped['endMs'] !== null) {
        $endMs = $snapped['endMs'];
    }
    $startedAt = isoOrSnapped($startedAtKeep, commandMsFromIso($startedAtKeep), $startMs);
    $endedAtIso = $prevOpen
        ? null
        : isoOrSnapped($endedAtKeep, commandMsFromIso($endedAtKeep), $endMs);

    validateEventRange(
        allEvents($chunks),
        $startMs,
        $endMs,
        $eventId,
        $nowMs,
        $validateEndBound,
    );

    $taskChanged = ($prev['taskId'] ?? null) !== $task['id'];
    $updated = $prev;
    $updated['taskId'] = $task['id'];
    $updated['folderId'] = $folder['id'];
    if ($taskChanged) {
        $updated['taskName'] = $task['name'];
        $updated['folderName'] = $folder['name'];
        $updated['taskColor'] = $task['color'];
        $updated['folderColor'] = $folder['color'];
    }
    $updated['startedAt'] = $startedAt;
    $updated['endedAt'] = $endedAtIso;
    $updated['updatedAt'] = $stamp;

    $dirty = upsertEvents(
        $chunks,
        replacementsFromPatches($chunks, $snapped['patches'], $updated, $stamp),
        $stamp,
    );
    $written = persistCommandWrites($dataDir, $index, $dirty, $stamp);
    echoCommandWrite($tasks, $index, $chunks, $written);
}

function handleDelete(string $dataDir): void
{
    $body = readJsonBody(true);
    $eventId = requireStringId($body['eventId'] ?? null, 'eventId');
    $stamp = commandIso(commandNow());
    $tasks = loadTasksFile($dataDir);
    $index = loadEventsIndex($dataDir);
    $chunks = loadChunks($dataDir, $index['chunks'], $stamp);
    if (findEventById($chunks, $eventId) === null) {
        fail(404, '記録が見つかりません');
    }
    $dirty = [];
    foreach ($chunks as $qid => $file) {
        $next = [];
        $hit = false;
        foreach ($file['events'] as $ev) {
            if (($ev['id'] ?? null) === $eventId) {
                $hit = true;
                continue;
            }
            $next[] = $ev;
        }
        if ($hit) {
            $dirty[$qid] = ['events' => $next, 'updatedAt' => $stamp];
            break;
        }
    }
    $written = persistCommandWrites($dataDir, $index, $dirty, $stamp);
    echoCommandWrite($tasks, $index, $chunks, $written);
}

function handleAdd(string $dataDir): void
{
    $body = readJsonBody(true);
    $taskId = requireStringId($body['taskId'] ?? null, 'taskId');
    if (!is_string($body['startedAt'] ?? null) || !is_string($body['endedAt'] ?? null)) {
        fail(400, '時刻が不正です');
    }
    $startDt = parseCommandAt($body['startedAt']);
    $endDt = parseCommandAt($body['endedAt']);
    $startMs0 = commandMs($startDt);
    $endMs0 = commandMs($endDt);
    $stampNow = commandNow();
    $nowMs = commandMs($stampNow);
    $stamp = commandIso($stampNow);

    $tasks = loadTasksFile($dataDir);
    [$task, $folder] = findTaskAndFolder($tasks, $taskId);
    $index = loadEventsIndex($dataDir);
    $chunks = loadChunks($dataDir, $index['chunks'], $stamp);

    $snapped = snapEventTimes(allEvents($chunks), null, $startMs0, $endMs0, $nowMs, 'both');
    $startMs = $snapped['startMs'];
    $endMs = $snapped['endMs'];
    if ($endMs === null) {
        fail(400, '終了時刻が不正です');
    }
    $startedAt = isoOrSnapped($body['startedAt'], $startMs0, $startMs);
    $endedAt = isoOrSnapped($body['endedAt'], $endMs0, $endMs);
    validateEventRange(allEvents($chunks), $startMs, $endMs, null, $nowMs, true);

    $ev = [
        'id' => newUuid(),
        'taskId' => $task['id'],
        'folderId' => $folder['id'],
        'taskName' => $task['name'],
        'folderName' => $folder['name'],
        'taskColor' => $task['color'],
        'folderColor' => $folder['color'],
        'startedAt' => $startedAt,
        'endedAt' => $endedAt,
        'createdAt' => $stamp,
        'updatedAt' => $stamp,
    ];
    $dirty = upsertEvents(
        $chunks,
        replacementsFromPatches($chunks, $snapped['patches'], $ev, $stamp),
        $stamp,
    );
    $written = persistCommandWrites($dataDir, $index, $dirty, $stamp);
    echoCommandWrite($tasks, $index, $chunks, $written);
}

function handleJoin(string $dataDir): void
{
    $body = readJsonBody(true);
    $olderId = requireStringId($body['olderId'] ?? null, 'olderId');
    $newerId = requireStringId($body['newerId'] ?? null, 'newerId');
    if ($olderId === $newerId) {
        fail(400, '同じ記録の境界は編集できません');
    }
    if (array_key_exists('at', $body) && $body['at'] !== null && !is_string($body['at'])) {
        fail(400, '時刻が不正です');
    }

    $stampNow = commandNow();
    $nowMs = commandMs($stampNow);
    $stamp = commandIso($stampNow);
    $tasks = loadTasksFile($dataDir);
    $index = loadEventsIndex($dataDir);
    $chunks = loadChunks($dataDir, $index['chunks'], $stamp);
    $older = findEventById($chunks, $olderId);
    $newer = findEventById($chunks, $newerId);
    if ($older === null || $newer === null) {
        fail(404, '記録が見つかりません');
    }
    if (!isset($older['endedAt']) || !is_string($older['endedAt'])) {
        fail(400, '前の記録が終了していません');
    }
    if (eventStartMs($older) > eventStartMs($newer)) {
        fail(400, '記録の前後が逆です');
    }

    $olderEnd = eventEndMsOf($older, $nowMs);
    $newerStart = eventStartMs($newer);
    if (isset($body['at']) && is_string($body['at']) && $body['at'] !== '') {
        $atDt = parseCommandAt($body['at']);
        $mid = commandMs($atDt);
        $iso = isoOrSnapped($body['at'], commandMsFromIso($body['at']), $mid);
    } else {
        $mid = (int) round(($olderEnd + $newerStart) / 2);
        $iso = $olderEnd === $newerStart
            ? $older['endedAt']
            : commandIsoFromMs($mid);
    }

    assertDuration(eventStartMs($older), $mid, '前の記録');
    $newerEnd = eventEndMsOf($newer, $nowMs);
    if (isset($newer['endedAt']) && is_string($newer['endedAt'])) {
        assertDuration($mid, $newerEnd, '次の記録');
    } elseif ($mid > $nowMs + COMMAND_FUTURE_GRACE_MS) {
        fail(400, '未来の時間には記録を作れません');
    } elseif ($newerEnd - $mid < COMMAND_MIN_RECORD_MS) {
        fail(400, '次の記録が1秒未満になります');
    }

    $all = allEvents($chunks);
    $hitOlder = findOverlap($all, eventStartMs($older), $mid, $olderId, $nowMs);
    if ($hitOlder !== null && ($hitOlder['id'] ?? null) !== $newerId) {
        failOverlap($hitOlder);
    }
    $hitNewer = findOverlap($all, $mid, $newerEnd, $newerId, $nowMs);
    if ($hitNewer !== null && ($hitNewer['id'] ?? null) !== $olderId) {
        failOverlap($hitNewer);
    }

    if ($olderEnd === $mid && $newerStart === $mid) {
        echoCommandResult([
            'ok' => true,
            'current' => findOpenEvent($chunks),
            'last' => lastEndedByStart($chunks),
            'tasksUpdatedAt' => tasksUpdatedAt($tasks),
            'index' => $index,
            'chunks' => new stdClass(),
            'boundary' => $iso,
        ]);
        return;
    }

    $older['endedAt'] = $iso;
    $older['updatedAt'] = $stamp;
    $newer['startedAt'] = $iso;
    $newer['updatedAt'] = $stamp;
    $dirty = upsertEvents($chunks, [$older, $newer], $stamp);
    $written = persistCommandWrites($dataDir, $index, $dirty, $stamp);
    echoCommandWrite($tasks, $index, $chunks, $written, ['boundary' => $iso]);
}

function handleFolderSave(string $dataDir): void
{
    $body = readJsonBody(true);
    $name = requireMasterName($body['name'] ?? null);
    $color = requireMasterColor($body['color'] ?? null);
    $id = $body['id'] ?? null;
    if ($id !== null && (!is_string($id) || $id === '')) {
        fail(400, 'id が不正です');
    }
    // フォルダ色を変えたときのタスク色はパレット計算（UI 側）の結果をそのまま受ける
    $taskColors = $body['taskColors'] ?? null;
    if ($taskColors !== null && !is_array($taskColors)) {
        fail(400, 'taskColors が不正です');
    }

    $stamp = commandIso(commandNow());
    $file = loadTasksFile($dataDir);
    $folders = masterList($file, 'folders');
    $tasks = masterList($file, 'tasks');

    if (is_string($id)) {
        $i = findMasterIndex($folders, $id);
        if ($i < 0) {
            fail(404, 'フォルダが見つかりません');
        }
        $folders[$i]['name'] = $name;
        $folders[$i]['color'] = $color;
        $folders[$i]['updatedAt'] = $stamp;
        $folderId = $id;
    } else {
        $folderId = newUuid();
        $folders[] = [
            'id' => $folderId,
            'name' => $name,
            'color' => $color,
            'sortOrder' => count($folders),
            'createdAt' => $stamp,
            'updatedAt' => $stamp,
        ];
    }

    if (is_array($taskColors)) {
        foreach ($taskColors as $taskId => $taskColor) {
            if (!is_string($taskId) || $taskId === '') {
                fail(400, 'taskColors が不正です');
            }
            $c = requireMasterColor($taskColor);
            $ti = findMasterIndex($tasks, $taskId);
            if ($ti < 0) {
                fail(404, 'タスクが見つかりません');
            }
            if (($tasks[$ti]['folderId'] ?? null) !== $folderId) {
                fail(400, 'タスクがそのフォルダにありません');
            }
            // 自由指定（座標なし）はフォルダ色に追従しない。変えるなら task-save
            if (($tasks[$ti]['colorRef'] ?? null) === null) {
                fail(400, '自由指定の色はフォルダ色では変えられません');
            }
            if (($tasks[$ti]['color'] ?? null) === $c) {
                continue;
            }
            $tasks[$ti]['color'] = $c;
            $tasks[$ti]['updatedAt'] = $stamp;
        }
    }

    echoTasks(saveTasksFile($dataDir, $folders, $tasks, $stamp));
}

function handleFolderMove(string $dataDir): void
{
    $body = readJsonBody(true);
    $folderId = requireStringId($body['folderId'] ?? null, 'folderId');
    $dir = $body['dir'] ?? null;
    if ($dir !== 1 && $dir !== -1) {
        fail(400, 'dir は 1 か -1 です');
    }

    $stamp = commandIso(commandNow());
    $file = loadTasksFile($dataDir);
    $tasks = masterList($file, 'tasks');
    $sorted = sortedByOrder(masterList($file, 'folders'));
    $i = findMasterIndex($sorted, $folderId);
    if ($i < 0) {
        fail(404, 'フォルダが見つかりません');
    }
    $j = $i + $dir;
    if ($j < 0 || $j >= count($sorted)) {
        echoTasks($file);
        return;
    }
    [$sorted[$i], $sorted[$j]] = [$sorted[$j], $sorted[$i]];
    foreach ($sorted as $idx => $folder) {
        if (($folder['sortOrder'] ?? null) === $idx) {
            continue;
        }
        $sorted[$idx]['sortOrder'] = $idx;
        $sorted[$idx]['updatedAt'] = $stamp;
    }

    echoTasks(saveTasksFile($dataDir, $sorted, $tasks, $stamp));
}

function handleFolderDelete(string $dataDir): void
{
    $body = readJsonBody(true);
    $folderId = requireStringId($body['folderId'] ?? null, 'folderId');

    $stamp = commandIso(commandNow());
    $file = loadTasksFile($dataDir);
    $folders = masterList($file, 'folders');
    $tasks = masterList($file, 'tasks');
    if (findMasterIndex($folders, $folderId) < 0) {
        fail(404, 'フォルダが見つかりません');
    }
    foreach ($tasks as $task) {
        if (($task['folderId'] ?? null) === $folderId) {
            fail(400, 'タスクがあるフォルダは削除できません');
        }
    }
    $rest = [];
    foreach (sortedByOrder($folders) as $folder) {
        if (($folder['id'] ?? null) === $folderId) {
            continue;
        }
        $rest[] = $folder;
    }
    foreach ($rest as $idx => $folder) {
        if (($folder['sortOrder'] ?? null) === $idx) {
            continue;
        }
        $rest[$idx]['sortOrder'] = $idx;
        $rest[$idx]['updatedAt'] = $stamp;
    }

    echoTasks(saveTasksFile($dataDir, $rest, $tasks, $stamp));
}

function handleTaskSave(string $dataDir): void
{
    $body = readJsonBody(true);
    $name = requireMasterName($body['name'] ?? null);
    $color = requireMasterColor($body['color'] ?? null);
    $folderId = requireStringId($body['folderId'] ?? null, 'folderId');
    $id = $body['id'] ?? null;
    if ($id !== null && (!is_string($id) || $id === '')) {
        fail(400, 'id が不正です');
    }
    // 欄ごと省いたら現状維持。null は自由指定（フォルダ色に追従しない）
    $refProvided = array_key_exists('colorRef', $body);
    $colorRef = $refProvided && $body['colorRef'] !== null
        ? requireTaskColorRef($body['colorRef'])
        : null;

    $stamp = commandIso(commandNow());
    $file = loadTasksFile($dataDir);
    $folders = masterList($file, 'folders');
    $tasks = masterList($file, 'tasks');
    if (findMasterIndex($folders, $folderId) < 0) {
        fail(404, 'フォルダが見つかりません');
    }

    $countIn = static function (array $rows, string $fid): int {
        $n = 0;
        foreach ($rows as $row) {
            if (($row['folderId'] ?? null) === $fid) {
                $n++;
            }
        }
        return $n;
    };

    if (is_string($id)) {
        $i = findMasterIndex($tasks, $id);
        if ($i < 0) {
            fail(404, 'タスクが見つかりません');
        }
        $moved = ($tasks[$i]['folderId'] ?? null) !== $folderId;
        $tasks[$i]['name'] = $name;
        $tasks[$i]['color'] = $color;
        $tasks[$i]['folderId'] = $folderId;
        if ($refProvided) {
            $tasks[$i]['colorRef'] = $colorRef;
        }
        if ($moved) {
            // 移動先の末尾へ。元の並び番号を持ち込むと既存タスクと衝突する
            $tasks[$i]['sortOrder'] = $countIn($tasks, $folderId) - 1;
        }
        $tasks[$i]['updatedAt'] = $stamp;
    } else {
        $tasks[] = [
            'id' => newUuid(),
            'folderId' => $folderId,
            'name' => $name,
            'color' => $color,
            'colorRef' => $colorRef,
            'sortOrder' => $countIn($tasks, $folderId),
            'createdAt' => $stamp,
            'updatedAt' => $stamp,
        ];
    }

    echoTasks(saveTasksFile($dataDir, $folders, $tasks, $stamp));
}

function handleTaskReorder(string $dataDir): void
{
    $body = readJsonBody(true);
    $folderId = requireStringId($body['folderId'] ?? null, 'folderId');
    $orderedIds = $body['orderedIds'] ?? null;
    if (!is_array($orderedIds)) {
        fail(400, 'orderedIds が必要です');
    }
    $ids = [];
    foreach ($orderedIds as $id) {
        if (!is_string($id) || $id === '') {
            fail(400, 'orderedIds が不正です');
        }
        $ids[] = $id;
    }

    $stamp = commandIso(commandNow());
    $file = loadTasksFile($dataDir);
    $folders = masterList($file, 'folders');
    $tasks = masterList($file, 'tasks');

    $inFolder = [];
    foreach ($tasks as $task) {
        if (($task['folderId'] ?? null) === $folderId) {
            $inFolder[] = (string) $task['id'];
        }
    }
    if (count($ids) !== count($inFolder) || array_diff($inFolder, $ids) !== [] || count(array_unique($ids)) !== count($ids)) {
        fail(400, 'そのフォルダのタスクと一致しません');
    }

    $order = array_flip($ids);
    $changed = false;
    foreach ($tasks as $i => $task) {
        $id = (string) $task['id'];
        if (!isset($order[$id])) {
            continue;
        }
        if (($task['sortOrder'] ?? null) === $order[$id]) {
            continue;
        }
        $tasks[$i]['sortOrder'] = $order[$id];
        $tasks[$i]['updatedAt'] = $stamp;
        $changed = true;
    }
    if (!$changed) {
        echoTasks($file);
        return;
    }

    echoTasks(saveTasksFile($dataDir, $folders, $tasks, $stamp));
}

function handleTaskDelete(string $dataDir): void
{
    $body = readJsonBody(true);
    $taskId = requireStringId($body['taskId'] ?? null, 'taskId');

    $stampNow = commandNow();
    $endMs = commandMs($stampNow);
    $stamp = commandIso($stampNow);
    $file = loadTasksFile($dataDir);
    $folders = masterList($file, 'folders');
    $tasks = masterList($file, 'tasks');
    $i = findMasterIndex($tasks, $taskId);
    if ($i < 0) {
        fail(404, 'タスクが見つかりません');
    }

    // 記録中のタスクを消すなら、同じ錠の中で記録も閉じる
    $index = loadEventsIndex($dataDir);
    $chunks = loadChunks($dataDir, $index['chunks'], $stamp);
    $open = findOpenEvent($chunks);
    $written = ['index' => $index, 'chunks' => []];
    if ($open !== null && ($open['taskId'] ?? null) === $taskId) {
        $dirty = closeOpenAcrossChunks($chunks, $endMs, $stamp, (string) $open['id']);
        if ($dirty !== []) {
            $written = persistCommandWrites($dataDir, $index, $dirty, $stamp);
        }
    }

    array_splice($tasks, $i, 1);
    $saved = saveTasksFile($dataDir, $folders, $tasks, $stamp);
    $overlay = mergeOverlay($chunks, $written['chunks']);
    echoTasks($saved, [
        'current' => findOpenEvent($overlay),
        'last' => lastEndedByStart($overlay),
        'index' => $written['index'],
        'chunks' => $written['chunks'] === [] ? new stdClass() : $written['chunks'],
    ]);
}

function handleCommand(string $dataDir, string $resource, string $method): void
{
    $lock = commandsLockPath($dataDir);
    $dir = dirname($lock);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        fail(500, 'mkdir failed');
    }

    if ($resource === 'now') {
        if ($method !== 'GET') {
            fail(405, 'method not allowed');
        }
        withResourceLock($lock, LOCK_SH, static function () use ($dataDir): void {
            handleNow($dataDir);
        });
        return;
    }

    $writes = [
        'start' => 'handleStart',
        'stop' => 'handleStop',
        'update' => 'handleUpdate',
        'delete' => 'handleDelete',
        'add' => 'handleAdd',
        'join' => 'handleJoin',
        'folder-save' => 'handleFolderSave',
        'folder-move' => 'handleFolderMove',
        'folder-delete' => 'handleFolderDelete',
        'task-save' => 'handleTaskSave',
        'task-reorder' => 'handleTaskReorder',
        'task-delete' => 'handleTaskDelete',
    ];
    $handler = $writes[$resource] ?? null;
    if ($handler === null) {
        fail(400, 'invalid resource');
    }
    if ($method !== 'POST') {
        fail(405, 'method not allowed');
    }
    withResourceLock($lock, LOCK_EX, static function () use ($handler, $dataDir): void {
        $handler($dataDir);
    });
}
