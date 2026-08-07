<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path === '/photo.jpg') {
    $image = imagecreatetruecolor(480, 320);
    $background = imagecolorallocate($image, 39, 75, 91);
    $foreground = imagecolorallocate($image, 223, 188, 94);
    imagefill($image, 0, 0, $background);
    imagefilledellipse($image, 240, 160, 210, 210, $foreground);
    header('Content-Type: image/jpeg');
    imagejpeg($image, null, 90);
    imagedestroy($image);
    exit;
}

if ($path !== '/v1/search') {
    http_response_code(404);
    exit;
}

if (($_SERVER['HTTP_AUTHORIZATION'] ?? '') !== 'test-pexels-key') {
    http_response_code(401);
    exit;
}
if (($_GET['per_page'] ?? '') !== '30' || ($_GET['orientation'] ?? '') !== 'square') {
    http_response_code(422);
    exit;
}

$query = trim((string) ($_GET['query'] ?? ''));
$port = (int) ($_SERVER['SERVER_PORT'] ?? 0);
$photoId = (int) sprintf('%u', crc32($query));
header('Content-Type: application/json');
header('X-Ratelimit-Remaining: 199');
header('X-Ratelimit-Reset: 1800000000');
$photos = str_starts_with($query, 'noresults') ? [] : [[
    'id' => $photoId,
    'width' => 480,
    'height' => 320,
    'url' => 'https://www.pexels.com/photo/' . $photoId . '/',
    'photographer' => 'Mock Photographer',
    'photographer_url' => 'https://www.pexels.com/@mock-photographer',
    'photographer_id' => 42,
    'avg_color' => '#274b5b',
    'alt' => 'Mock Pexels result for ' . $query,
    'src' => [
        'medium' => "http://127.0.0.1:{$port}/photo.jpg",
    ],
]];
echo json_encode([
    'page' => 1,
    'per_page' => 30,
    'total_results' => count($photos),
    'photos' => $photos,
], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
