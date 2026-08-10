<?php

declare(strict_types=1);

namespace Mom\Api;

use PHPMailer\PHPMailer\PHPMailer;
use Throwable;

final class Mailer
{
    public function __construct(private readonly Config $config)
    {
    }

    public function sendEmailConfirmation(string $email, string $token): void
    {
        $url = $this->actionUrl('/verify-email', $token);
        $this->send(
            $email,
            'Confirm your email',
            'Confirm your email',
            'Confirm ' . $email . ' to finish creating your Polymind account.',
            'Confirm email',
            $url,
            'This link expires in 24 hours.',
        );
    }

    public function sendPasswordReset(string $email, string $token): void
    {
        $url = $this->actionUrl('/reset-password', $token);
        $this->send(
            $email,
            'Reset your password',
            'Reset your password',
            'Use this link to choose a new password for your Polymind account.',
            'Reset password',
            $url,
            'This link expires in 1 hour. Ignore this email if you did not request it.',
        );
    }

    private function actionUrl(string $path, string $token): string
    {
        if ($this->config->appUrl === '') {
            throw new ApiException(503, 'Email delivery is not configured.');
        }

        return $this->config->appUrl . $path . '?token=' . rawurlencode($token);
    }

    private function send(
        string $recipient,
        string $subject,
        string $heading,
        string $message,
        string $action,
        string $url,
        string $footer,
    ): void {
        if ($this->config->mailHost === '' || $this->config->mailFromAddress === '') {
            throw new ApiException(503, 'Email delivery is not configured.');
        }

        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host = $this->config->mailHost;
            $mail->Port = $this->config->mailPort;
            $mail->SMTPAuth = $this->config->mailUsername !== '';
            $mail->Username = $this->config->mailUsername;
            $mail->Password = $this->config->mailPassword;
            $mail->SMTPSecure = $this->config->mailEncryption;
            $mail->SMTPAutoTLS = $this->config->mailEncryption !== '';
            $mail->Timeout = 10;
            $mail->CharSet = PHPMailer::CHARSET_UTF8;
            $mail->setFrom($this->config->mailFromAddress, $this->config->mailFromName);
            $mail->addAddress($recipient);
            $mail->Subject = $subject;
            $mail->isHTML(true);
            $mail->Body = $this->htmlTemplate($heading, $message, $action, $url, $footer);
            $mail->AltBody = implode("\n\n", [$heading, $message, $action . ': ' . $url, $footer]);
            $mail->send();
        } catch (Throwable $exception) {
            error_log('[mom-api/mail] ' . $exception->getMessage());
            throw new ApiException(
                503,
                'We could not send the email. Please try again.',
                [],
                $exception,
            );
        }
    }

    private function htmlTemplate(
        string $heading,
        string $message,
        string $action,
        string $url,
        string $footer,
    ): string {
        $escape = static fn (string $value): string => htmlspecialchars(
            $value,
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8',
        );

        return '<!doctype html><html lang="en"><body style="margin:0;padding:32px;'
            . 'font-family:Arial,sans-serif;color:#191c19;background:#ffffff">'
            . '<main style="max-width:520px;margin:0 auto">'
            . '<p style="margin:0 0 24px;font-size:14px;font-weight:700">Polymind</p>'
            . '<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2">'
            . $escape($heading) . '</h1>'
            . '<p style="margin:0 0 24px;font-size:16px;line-height:1.5">'
            . $escape($message) . '</p>'
            . '<p style="margin:0 0 24px"><a href="' . $escape($url) . '" '
            . 'style="display:inline-block;padding:12px 18px;border-radius:8px;'
            . 'background:#191c19;color:#ffffff;font-weight:700;text-decoration:none">'
            . $escape($action) . '</a></p>'
            . '<p style="margin:0;color:#626862;font-size:13px;line-height:1.5">'
            . $escape($footer) . '</p>'
            . '</main></body></html>';
    }
}
