<?php

declare(strict_types=1);

$token = getenv('MOM_TEST_CODEX_BRIDGE_TOKEN') ?: '';
$statePath = getenv('MOM_TEST_CODEX_BRIDGE_STATE') ?: '';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($path === '/health') {
    echo json_encode(['status' => 'ok']);
    return;
}

if (($token === '') || (($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== 'Bearer ' . $token)) {
    http_response_code(401);
    echo json_encode(['message' => 'Unauthorized.']);
    return;
}

if (preg_match('#^/v1/connections/([a-f0-9]{64})$#', $path, $matches) !== 1) {
    http_response_code(404);
    echo json_encode(['message' => 'Not found.']);
    return;
}

$subject = $matches[1];
$state = [];
if ($statePath !== '' && is_file($statePath)) {
    $decoded = json_decode((string) file_get_contents($statePath), true);
    if (is_array($decoded)) {
        $state = $decoded;
    }
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if ($method === 'GET') {
    if (!empty($state[$subject])) {
        echo json_encode([
            'available' => true,
            'connected' => true,
            'email' => 'alice@example.test',
            'planType' => 'plus',
        ]);
        return;
    }
    echo json_encode(['available' => true, 'connected' => false]);
    return;
}

if ($method === 'POST') {
    $state[$subject] = true;
    file_put_contents($statePath, json_encode($state, JSON_THROW_ON_ERROR), LOCK_EX);
    echo json_encode([
        'available' => true,
        'connected' => false,
        'pending' => true,
        'verificationUrl' => 'https://auth.openai.com/codex/device',
        'userCode' => 'MOM-TEST',
    ]);
    return;
}

if ($method === 'DELETE') {
    unset($state[$subject]);
    file_put_contents($statePath, json_encode($state, JSON_THROW_ON_ERROR), LOCK_EX);
    echo json_encode(['available' => true, 'connected' => false]);
    return;
}

http_response_code(404);
echo json_encode(['message' => 'Not found.']);
