<?php

declare(strict_types=1);

$port = isset($argv[1]) ? (int) $argv[1] : 0;
$mailbox = $argv[2] ?? '';
if ($port < 1 || $mailbox === '') {
    fwrite(STDERR, "Usage: php smtp-server.php <port> <mailbox>\n");
    exit(1);
}

$server = stream_socket_server(
    'tcp://127.0.0.1:' . $port,
    $errorCode,
    $errorMessage,
);
if ($server === false) {
    fwrite(STDERR, "SMTP fixture failed: {$errorCode} {$errorMessage}\n");
    exit(1);
}

while ($connection = @stream_socket_accept($server, -1)) {
    fwrite($connection, "220 localhost BackOnTrack test SMTP\r\n");
    $dataMode = false;
    $message = '';

    while (($line = fgets($connection)) !== false) {
        $command = rtrim($line, "\r\n");
        if ($dataMode) {
            if ($command === '.') {
                file_put_contents(
                    $mailbox,
                    "\n=== MESSAGE ===\n" . $message,
                    FILE_APPEND | LOCK_EX,
                );
                $dataMode = false;
                $message = '';
                fwrite($connection, "250 2.0.0 accepted\r\n");
                continue;
            }
            $message .= str_starts_with($command, '..') ? substr($line, 1) : $line;
            continue;
        }

        $verb = strtoupper(strtok($command, ' ') ?: '');
        if ($verb === 'EHLO') {
            fwrite($connection, "250-localhost\r\n250 8BITMIME\r\n");
        } elseif ($verb === 'HELO' || $verb === 'MAIL' || $verb === 'RCPT' || $verb === 'RSET') {
            fwrite($connection, "250 2.0.0 ok\r\n");
        } elseif ($verb === 'DATA') {
            $dataMode = true;
            fwrite($connection, "354 End data with <CR><LF>.<CR><LF>\r\n");
        } elseif ($verb === 'QUIT') {
            fwrite($connection, "221 2.0.0 bye\r\n");
            break;
        } else {
            fwrite($connection, "250 2.0.0 ok\r\n");
        }
    }

    fclose($connection);
}
