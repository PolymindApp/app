<?php

declare(strict_types=1);

const WORDNET_CORE_URL = 'https://wordnet.cs.princeton.edu/downloads/5K.clean.txt';
const WORDNET_ARCHIVE_URL = 'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz';
const WORDNET_21_ARCHIVE_URL = 'https://wordnetcode.princeton.edu/2.1/WordNet-2.1.tar.gz';
const OMW_ARCHIVE_URL = 'https://github.com/omwn/omw-data/archive/refs/heads/main.zip';

$projectRoot = dirname(__DIR__);
$output = $projectRoot . '/server/seeds/image-concepts.jsonl';
$temporaryRoot = sys_get_temp_dir() . '/polymind-image-concepts-' . bin2hex(random_bytes(8));

if (!extension_loaded('curl') || !extension_loaded('zip')) {
    fwrite(STDERR, "The cURL and Zip PHP extensions are required.\n");
    exit(1);
}
if (!mkdir($temporaryRoot, 0700, true) && !is_dir($temporaryRoot)) {
    fwrite(STDERR, "A temporary image-concept directory could not be created.\n");
    exit(1);
}

try {
    $corePath = $temporaryRoot . '/core.txt';
    $wordnetPath = $temporaryRoot . '/wordnet.tar.gz';
    $wordnet21Path = $temporaryRoot . '/wordnet-2.1.tar.gz';
    $omwPath = $temporaryRoot . '/omw.zip';
    downloadFile(WORDNET_CORE_URL, $corePath);
    downloadFile(WORDNET_ARCHIVE_URL, $wordnetPath);
    downloadFile(WORDNET_21_ARCHIVE_URL, $wordnet21Path);
    downloadFile(OMW_ARCHIVE_URL, $omwPath);

    $index = loadSenseIndex($wordnetPath);
    $wordnetData = loadWordnetData($wordnetPath);
    $index21 = loadSenseIndex($wordnet21Path, 'WordNet-2.1');
    $wordnet21Data = loadWordnetData($wordnet21Path, 'WordNet-2.1');
    $concepts = loadCoreConcepts($corePath, $index, $wordnetData, $index21, $wordnet21Data);
    [$sources, $translatedTerms] = loadOmwTerms($omwPath, array_keys($concepts));

    $sources = [
        'pwn-core-3.0' => [
            'name' => 'Princeton WordNet Core Synsets',
            'language' => 'en',
            'source_url' => WORDNET_CORE_URL,
            'license_name' => 'WordNet License',
            'license_url' => 'https://wordnet.princeton.edu/license-and-commercial-use',
            'attribution' => 'WordNet Core, WordNet 2.1 and WordNet 3.0, Princeton University.',
        ],
        ...$sources,
        'polymind-prepositions-1' => [
            'name' => 'Polymind common English preposition supplement',
            'language' => 'en',
            'source_url' => '',
            'license_name' => 'Project data',
            'license_url' => '',
            'attribution' => 'Curated for the Polymind image concept catalog.',
        ],
    ];

    foreach ($concepts as $sourceKey => &$concept) {
        foreach ($translatedTerms[$sourceKey] ?? [] as $term) {
            $concept['terms'][] = $term;
        }
        $concept['terms'] = uniqueTerms($concept['terms']);
    }
    unset($concept);
    foreach (prepositionConcepts() as $concept) {
        $concepts[$concept['source_key']] = $concept;
    }

    $directory = dirname($output);
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        throw new RuntimeException('The seed output directory could not be created.');
    }
    $temporaryOutput = $output . '.tmp-' . bin2hex(random_bytes(4));
    $stream = fopen($temporaryOutput, 'wb');
    if ($stream === false) {
        throw new RuntimeException('The seed output could not be opened.');
    }
    try {
        writeJsonLine($stream, ['type' => 'metadata', 'sources' => $sources]);
        foreach ($concepts as $concept) {
            writeJsonLine($stream, $concept);
        }
    } finally {
        fclose($stream);
    }
    if (!rename($temporaryOutput, $output)) {
        throw new RuntimeException('The generated seed could not be finalized.');
    }
    fwrite(STDOUT, sprintf(
        "Generated %d concepts with %d localized terms at %s.\n",
        count($concepts),
        array_sum(array_map(static fn (array $concept): int => count($concept['terms']), $concepts)),
        $output,
    ));
} catch (Throwable $exception) {
    fwrite(STDERR, 'Image concept seed generation failed: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
} finally {
    removeTemporaryTree($temporaryRoot);
}

function downloadFile(string $url, string $path): void
{
    $stream = fopen($path, 'wb');
    if ($stream === false) {
        throw new RuntimeException('A source download could not be opened.');
    }
    $curl = curl_init($url);
    if ($curl === false) {
        fclose($stream);
        throw new RuntimeException('A source download could not be initialized.');
    }
    curl_setopt_array($curl, [
        CURLOPT_FILE => $stream,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_FAILONERROR => true,
        CURLOPT_USERAGENT => 'Polymind image concept seed builder',
    ]);
    try {
        if (curl_exec($curl) !== true) {
            throw new RuntimeException('A source download failed: ' . curl_error($curl));
        }
    } finally {
        curl_close($curl);
        fclose($stream);
    }
}

/** @return array{exact: array<string, string>, candidates: array<string, list<string>>, lemma_pos: array<string, list<string>>} */
function loadSenseIndex(string $archivePath, string $archiveRoot = 'WordNet-3.0'): array
{
    $stream = fopen('phar://' . $archivePath . "/{$archiveRoot}/dict/index.sense", 'rb');
    if ($stream === false) {
        throw new RuntimeException('The WordNet sense index could not be read.');
    }
    $exact = [];
    $candidates = [];
    $lemmaPos = [];
    while (($line = fgets($stream)) !== false) {
        $parts = preg_split('/\s+/', trim($line));
        if (count($parts) >= 2) {
            $senseKey = strtolower($parts[0]);
            $offset = str_pad($parts[1], 8, '0', STR_PAD_LEFT);
            $exact[$senseKey] = $offset;
            if (preg_match('/^([^%]+)%(\d):(\d{2}):/', $senseKey, $matches) === 1) {
                $candidates[$matches[1] . '|' . $matches[3]][] = $offset;
                $normalizedPos = match ($matches[2]) {
                    '1' => 'n',
                    '2' => 'v',
                    '3', '5' => 'a',
                    '4' => 'r',
                    default => '',
                };
                if ($normalizedPos !== '') {
                    $lemmaPos[$matches[1] . '|' . $normalizedPos][] = $offset;
                }
            }
        }
    }
    fclose($stream);
    return ['exact' => $exact, 'candidates' => $candidates, 'lemma_pos' => $lemmaPos];
}

/**
 * @return array{
 *   glosses: array<string, string>,
 *   lemma_synsets: array<string, list<string>>,
 *   synset_terms: array<string, list<string>>,
 *   lex_numbers: array<string, int>
 * }
 */
function loadWordnetData(string $archivePath, string $archiveRoot = 'WordNet-3.0'): array
{
    $glosses = [];
    $lemmaSynsets = [];
    $synsetTerms = [];
    $lexNumbers = [];
    foreach (['noun' => 'n', 'verb' => 'v', 'adj' => 'a', 'adv' => 'r'] as $file => $pos) {
        $stream = fopen('phar://' . $archivePath . "/{$archiveRoot}/dict/data.{$file}", 'rb');
        if ($stream === false) {
            throw new RuntimeException("The WordNet {$file} data could not be read.");
        }
        while (($line = fgets($stream)) !== false) {
            if (preg_match('/^(\d{8})\s/', $line, $matches) !== 1) {
                continue;
            }
            $separator = strpos($line, '|');
            if ($separator !== false) {
                $key = $matches[1] . '-' . $pos;
                $glosses[$key] = trim(substr($line, $separator + 1));
                $tokens = preg_split('/\s+/', trim(substr($line, 0, $separator))) ?: [];
                $wordCount = isset($tokens[3]) ? hexdec($tokens[3]) : 0;
                $words = [];
                for ($index = 0; $index < $wordCount; $index++) {
                    $word = strtolower((string) ($tokens[4 + $index * 2] ?? ''));
                    if ($word === '') {
                        continue;
                    }
                    $words[] = $word;
                    $lemmaSynsets[$word . '|' . $pos][] = $matches[1];
                }
                $synsetTerms[$key] = array_values(array_unique($words));
                $lexNumbers[$key] = (int) ($tokens[1] ?? -1);
            }
        }
        fclose($stream);
    }
    return [
        'glosses' => $glosses,
        'lemma_synsets' => $lemmaSynsets,
        'synset_terms' => $synsetTerms,
        'lex_numbers' => $lexNumbers,
    ];
}

/**
 * @param array{exact: array<string, string>, candidates: array<string, list<string>>, lemma_pos: array<string, list<string>>} $index
 * @param array{
 *   glosses: array<string, string>,
 *   lemma_synsets: array<string, list<string>>,
 *   synset_terms: array<string, list<string>>,
 *   lex_numbers: array<string, int>
 * } $wordnetData
 * @param array{exact: array<string, string>, candidates: array<string, list<string>>, lemma_pos: array<string, list<string>>} $index21
 * @param array{
 *   glosses: array<string, string>,
 *   lemma_synsets: array<string, list<string>>,
 *   synset_terms: array<string, list<string>>,
 *   lex_numbers: array<string, int>
 * } $wordnet21Data
 * @return array<string, array<string, mixed>>
 */
function loadCoreConcepts(
    string $path,
    array $index,
    array $wordnetData,
    array $index21,
    array $wordnet21Data,
): array
{
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false || count($lines) !== 5000) {
        throw new RuntimeException('The WordNet core source does not contain 5,000 entries.');
    }
    $partNames = ['n' => 'noun', 'v' => 'verb', 'a' => 'adjective', 'r' => 'adverb'];
    $concepts = [];
    foreach ($lines as $lineNumber => $line) {
        if (preg_match('/^([nvar]) \[([^]]+)] \[([^]]+)](?: (.*))?$/u', $line, $matches) !== 1) {
            throw new RuntimeException('The WordNet core line ' . ($lineNumber + 1) . ' is invalid.');
        }
        $pos = $matches[1];
        $senseKey = strtolower($matches[2]);
        $canonical = normalizeTerm($matches[3]);
        preg_match('/^[^%]+%\d:(\d{2}):/', $senseKey, $categoryMatch);
        $categoryNumber = (int) ($categoryMatch[1] ?? -1);
        $offset = $index['exact'][$senseKey] ?? null;
        $version = '30';
        if ($offset === null) {
            $offset = $index21['exact'][$senseKey] ?? null;
            $version = '21';
        }
        if ($offset === null) {
            throw new RuntimeException("The WordNet sense {$senseKey} could not be mapped.");
        }
        $sourceKey = "pwn{$version}:{$offset}-{$pos}";
        $definitionSource = $version === '30' ? $wordnetData : $wordnet21Data;
        $concepts[$sourceKey] = [
            'source_key' => $sourceKey,
            'canonical_name' => $canonical,
            'part_of_speech' => $partNames[$pos],
            'semantic_category' => lexicographerCategory($categoryNumber),
            'definition' => $definitionSource['glosses']["{$offset}-{$pos}"] ?? '',
            'search_query' => $canonical,
            'terms' => uniqueTerms(array_map(
                static fn (string $term): array => [
                    'language' => 'en',
                    'term' => $term,
                    'source_id' => 'pwn-core-3.0',
                ],
                [$canonical],
            )),
        ];
    }
    return $concepts;
}

/**
 * @param list<string> $sourceKeys
 * @return array{array<string, array<string, string>>, array<string, list<array<string, string>>>}
 */
function loadOmwTerms(string $path, array $sourceKeys): array
{
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) {
        throw new RuntimeException('The Open Multilingual Wordnet archive could not be opened.');
    }
    try {
        $prefix = archivePrefix($zip);
        $indexToml = $zip->getFromName($prefix . 'index.toml');
        if (!is_string($indexToml)) {
            throw new RuntimeException('The Open Multilingual Wordnet index is missing.');
        }
        $packages = parseOmwPackages($indexToml);
        $wanted = array_fill_keys($sourceKeys, true);
        $sources = [];
        $terms = [];
        foreach ($packages as $id => $package) {
            if (($package['language'] ?? '') === 'en' || ($package['source'] ?? '') === '') {
                continue;
            }
            $sourcePath = $prefix . $package['source'];
            $contents = $zip->getFromName($sourcePath);
            if (!is_string($contents)) {
                throw new RuntimeException("The Open Multilingual Wordnet source {$id} is missing.");
            }
            [$licenseName, $licenseUrl] = normalizeLicense($package['license'] ?? '');
            $sources[$id] = [
                'name' => $package['label'] ?: $id,
                'language' => $package['language'],
                'source_url' => $package['url'] ?: 'https://github.com/omwn/omw-data',
                'license_name' => $licenseName,
                'license_url' => $licenseUrl,
                'attribution' => ($package['label'] ?: $id) . ' via Open Multilingual Wordnet.',
            ];
            foreach (preg_split('/\R/u', $contents) ?: [] as $line) {
                if ($line === '' || $line[0] === '#') {
                    continue;
                }
                $parts = explode("\t", $line, 3);
                if (count($parts) !== 3 || !str_ends_with($parts[1], ':lemma')) {
                    continue;
                }
                $sourceKey = 'pwn30:' . $parts[0];
                if (!isset($wanted[$sourceKey])) {
                    continue;
                }
                $term = normalizeTerm($parts[2]);
                if ($term === '') {
                    continue;
                }
                $terms[$sourceKey][] = [
                    'language' => $package['language'],
                    'term' => $term,
                    'source_id' => $id,
                ];
            }
        }
        ksort($sources, SORT_STRING);
        return [$sources, $terms];
    } finally {
        $zip->close();
    }
}

function archivePrefix(ZipArchive $zip): string
{
    $first = $zip->getNameIndex(0);
    if (!is_string($first) || !str_contains($first, '/')) {
        throw new RuntimeException('The Open Multilingual Wordnet archive layout is invalid.');
    }
    return substr($first, 0, strpos($first, '/') + 1);
}

/** @return array<string, array<string, string>> */
function parseOmwPackages(string $toml): array
{
    preg_match_all(
        '/^\[packages\.([^]]+)]\R(.*?)(?=^\[|\z)/ms',
        $toml,
        $matches,
        PREG_SET_ORDER,
    );
    $packages = [];
    foreach ($matches as $match) {
        $values = [];
        foreach (['label', 'language', 'license', 'source', 'url'] as $field) {
            if (preg_match('/^' . $field . '\s*=\s*"([^"]*)"/m', $match[2], $fieldMatch) === 1) {
                $values[$field] = trim($fieldMatch[1]);
            } else {
                $values[$field] = '';
            }
        }
        if ($values['language'] !== '' && $values['source'] !== '') {
            $packages[$match[1]] = $values;
        }
    }
    return $packages;
}

/** @return array{string, string} */
function normalizeLicense(string $license): array
{
    if ($license === 'wordnet') {
        return ['WordNet License', 'https://wordnet.princeton.edu/license-and-commercial-use'];
    }
    if (filter_var($license, FILTER_VALIDATE_URL) !== false) {
        return [$license, $license];
    }
    return [$license, ''];
}

/** @param list<array<string, string>> $terms @return list<array<string, string>> */
function uniqueTerms(array $terms): array
{
    $unique = [];
    foreach ($terms as $term) {
        if ($term['term'] === '') {
            continue;
        }
        $key = $term['language'] . "\0" . mb_strtolower($term['term']) . "\0" . $term['source_id'];
        $unique[$key] = $term;
    }
    $result = array_values($unique);
    usort($result, static fn (array $left, array $right): int => [
        $left['language'], $left['term'], $left['source_id'],
    ] <=> [
        $right['language'], $right['term'], $right['source_id'],
    ]);
    return $result;
}

/** @return list<array<string, mixed>> */
function prepositionConcepts(): array
{
    $words = [
        'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around',
        'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond',
        'by', 'despite', 'during', 'except', 'for', 'from', 'in', 'inside', 'into',
        'near', 'of', 'off', 'on', 'onto', 'opposite', 'outside', 'over', 'past',
        'through', 'throughout', 'to', 'toward', 'under', 'underneath', 'until',
        'up', 'upon', 'with', 'within', 'without',
    ];
    return array_map(static fn (string $word): array => [
        'source_key' => 'polymind:preposition:' . $word,
        'canonical_name' => $word,
        'part_of_speech' => 'preposition',
        'semantic_category' => 'function word',
        'definition' => 'A common English preposition.',
        'search_query' => $word,
        'terms' => [[
            'language' => 'en',
            'term' => $word,
            'source_id' => 'polymind-prepositions-1',
        ]],
    ], $words);
}

function lexicographerCategory(int $number): string
{
    $names = [
        'adj.all', 'adj.pert', 'adv.all', 'noun.Tops', 'noun.act', 'noun.animal',
        'noun.artifact', 'noun.attribute', 'noun.body', 'noun.cognition',
        'noun.communication', 'noun.event', 'noun.feeling', 'noun.food',
        'noun.group', 'noun.location', 'noun.motive', 'noun.object', 'noun.person',
        'noun.phenomenon', 'noun.plant', 'noun.possession', 'noun.process',
        'noun.quantity', 'noun.relation', 'noun.shape', 'noun.state',
        'noun.substance', 'noun.time', 'verb.body', 'verb.change',
        'verb.cognition', 'verb.communication', 'verb.competition',
        'verb.consumption', 'verb.contact', 'verb.creation', 'verb.emotion',
        'verb.motion', 'verb.perception', 'verb.possession', 'verb.social',
        'verb.stative', 'verb.weather', 'adj.ppl',
    ];
    return $names[$number] ?? '';
}

function normalizeTerm(string $term): string
{
    $term = str_replace('_', ' ', trim($term));
    return trim(preg_replace('/\s+/u', ' ', $term) ?? $term);
}

function writeJsonLine(mixed $stream, array $value): void
{
    $encoded = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    if (fwrite($stream, $encoded . "\n") === false) {
        throw new RuntimeException('The image concept seed could not be written.');
    }
}

function removeTemporaryTree(string $path): void
{
    $expectedPrefix = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'polymind-image-concepts-';
    if (!str_starts_with($path, $expectedPrefix) || !is_dir($path)) {
        return;
    }
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST,
    );
    foreach ($iterator as $item) {
        if ($item->isDir()) {
            rmdir($item->getPathname());
        } else {
            unlink($item->getPathname());
        }
    }
    rmdir($path);
}
