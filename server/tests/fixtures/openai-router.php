<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

header('Content-Type: application/json; charset=utf-8');

if ($path !== '/v1/models' || strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    http_response_code(404);
    echo json_encode(['error' => ['message' => 'Not found.']], JSON_UNESCAPED_SLASHES);
    exit;
}

if ($authorization !== 'Bearer sk-test-valid-1234567890-abcd') {
    http_response_code(401);
    echo json_encode(['error' => ['message' => 'Invalid API key.']], JSON_UNESCAPED_SLASHES);
    exit;
}

echo json_encode([
    'object' => 'list',
    'data' => [
        ['id' => 'test-model', 'object' => 'model'],
    ],
], JSON_UNESCAPED_SLASHES);
