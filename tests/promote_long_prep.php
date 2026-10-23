<?php
declare(strict_types=1);

function fail(int $code, string $message): void
{
    throw new RuntimeException($code . ' ' . $message);
}

require dirname(__DIR__) . '/api/commands.php';

$failed = 0;

function expect(bool $ok, string $label): void
{
    global $failed;
    if ($ok) {
        echo "ok  $label\n";
        return;
    }
    $failed++;
    echo "NG  $label\n";
}

$tasksFile = [
    'folders' => [
        ['id' => 'f1', 'name' => '生活', 'color' => '#000000'],
    ],
    'tasks' => [
        ['id' => 'prep', 'folderId' => 'f1', 'name' => '入眠準備', 'color' => '#111111'],
        ['id' => 'sleep', 'folderId' => 'f1', 'name' => '睡眠', 'color' => '#222222'],
        ['id' => 'rest', 'folderId' => 'f1', 'name' => '休憩', 'color' => '#333333'],
    ],
];

$start = '2026-10-20T12:00:00.000+09:00';
$plus5 = '2026-10-20T12:05:00.000+09:00';
$plus20 = '2026-10-20T12:20:00.000+09:00';
$plus40 = '2026-10-20T12:40:00.000+09:00';
$plus50 = '2026-10-20T12:50:00.000+09:00';
$stamp = '2026-10-20T13:00:00.000+09:00';
$nowMs = commandMsFromIso($stamp);

function ev(
    string $id,
    string $taskId,
    string $startedAt,
    ?string $endedAt,
    array $extra = [],
): array {
    return array_merge([
        'id' => $id,
        'taskId' => $taskId,
        'folderId' => 'f1',
        'taskName' => $taskId,
        'folderName' => '生活',
        'taskColor' => '#111111',
        'folderColor' => '#000000',
        'startedAt' => $startedAt,
        'endedAt' => $endedAt,
        'createdAt' => $startedAt,
        'updatedAt' => $startedAt,
    ], $extra);
}

function byTask(array $events, string $taskId): array
{
    return array_values(array_filter(
        $events,
        static fn (array $e): bool => ($e['taskId'] ?? '') === $taskId,
    ));
}

function promote(array $events, array $tasksFile, int $nowMs, string $stamp): array
{
    return promoteLongPrepToSleep($events, $tasksFile, $nowMs, $stamp);
}

$watchPrep = ev('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeew', 'prep', $start, $plus40, ['hs' => 'ASLEEP']);
$rest = ev('rest-1', 'rest', $plus40, $plus50);

$out = promote([$watchPrep, $rest], $tasksFile, $nowMs, $stamp);
$preps = byTask($out, 'prep');
$sleeps = byTask($out, 'sleep');
expect(count($preps) === 1, 'watch ASLEEP: 入眠準備は1本');
expect(count($sleeps) === 1, 'watch ASLEEP: 睡眠が1本');
expect(($preps[0]['startedAt'] ?? '') === $start, 'watch ASLEEP: 入眠準備の開始はそのまま');
expect(($preps[0]['endedAt'] ?? '') === $plus5, 'watch ASLEEP: 入眠準備は5分で閉じる');
expect(($preps[0]['hs'] ?? '') === 'ASLEEP', 'watch ASLEEP: 入眠準備の hs は残る');
expect(eventStartedByOf($preps[0]) === null, 'watch ASLEEP: 入眠準備に startedBy は付けない');
expect(($sleeps[0]['startedAt'] ?? '') === $plus5, 'watch ASLEEP: 睡眠は5分後から');
expect(($sleeps[0]['endedAt'] ?? '') === $plus40, 'watch ASLEEP: 睡眠は元の終了まで');
expect(($sleeps[0]['startedBy'] ?? '') === 'prep', 'watch ASLEEP: 睡眠は startedBy=prep');
expect(count(byTask($out, 'rest')) === 1, 'watch ASLEEP: 休憩は残る');

$passive = ev('bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeeew', 'prep', $start, $plus40, ['hs' => 'PASSIVE']);
$out = promote([$passive, $rest], $tasksFile, $nowMs, $stamp);
expect(count($out) === 2 && count(byTask($out, 'sleep')) === 0, 'watch PASSIVE: 直さない');

$noHs = ev('cccccccc-bbbb-cccc-dddd-eeeeeeeeeeeew', 'prep', $start, $plus40);
$out = promote([$noHs, $rest], $tasksFile, $nowMs, $stamp);
expect(count($out) === 2 && count(byTask($out, 'sleep')) === 0, 'watch で hs 無し: 直さない');

$browser = ev('11111111-2222-3333-4444-555555555555', 'prep', $start, $plus40);
$out = promote([$browser, $rest], $tasksFile, $nowMs, $stamp);
$sleeps = byTask($out, 'sleep');
expect(count($sleeps) === 1 && ($sleeps[0]['startedBy'] ?? '') === 'prep', 'ブラウザ: hs 無しでも直す');
expect((byTask($out, 'prep')[0]['endedAt'] ?? '') === $plus5, 'ブラウザ: 入眠準備は5分');

$autoIds = ['asleep', 'passive', 'exercise', 'resume'];
foreach ($autoIds as $by) {
    $auto = ev('uuid-auto-' . $by, 'prep', $start, $plus40, ['startedBy' => $by, 'hs' => 'ASLEEP']);
    $out = promote([$auto, $rest], $tasksFile, $nowMs, $stamp);
    expect(count(byTask($out, 'sleep')) === 0, "自動開始 startedBy=$by: 直さない");
}

$short = ev('dddddddd-bbbb-cccc-dddd-eeeeeeeeeeeew', 'prep', $start, $plus20, ['hs' => 'ASLEEP']);
$out = promote([$short, ev('rest-short', 'rest', $plus20, $plus50)], $tasksFile, $nowMs, $stamp);
expect(count(byTask($out, 'sleep')) === 0, '30分未満: 直さない');

$thenSleep = ev('eeeeeeee-bbbb-cccc-dddd-eeeeeeeeeeeew', 'prep', $start, $plus40, ['hs' => 'ASLEEP']);
$out = promote(
    [$thenSleep, ev('sleep-1', 'sleep', $plus40, $plus50)],
    $tasksFile,
    $nowMs,
    $stamp,
);
expect(count($out) === 2 && count(byTask($out, 'prep')) === 1, '次が睡眠: 直さない');

$open = ev('ffffffff-bbbb-cccc-dddd-eeeeeeeeeeeew', 'prep', $start, null, ['hs' => 'ASLEEP']);
$out = promote([$open], $tasksFile, $nowMs, $stamp);
expect(count($out) === 1 && ($out[0]['endedAt'] ?? null) === null, '開いている入眠準備: 直さない');

$watchWithBy = ev(
    'aaaaaaaa-bbbb-cccc-dddd-ffffffffffffw',
    'prep',
    $start,
    $plus40,
    ['hs' => 'ASLEEP', 'startedBy' => 'passive'],
);
$out = promote([$watchWithBy, $rest], $tasksFile, $nowMs, $stamp);
expect(count(byTask($out, 'sleep')) === 0, '条件1: startedBy があるウォッチ ASLEEP は直さない');

if ($failed > 0) {
    echo "FAILED $failed\n";
    exit(1);
}
echo "ALL OK\n";
