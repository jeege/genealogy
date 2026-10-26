// Package mailer 发送密码重置邮件。未配置 SMTP 时由调用方把链接写入日志。
package mailer

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/config"
)

// Mailer 是可选 SMTP 客户端。
type Mailer struct {
	cfg config.SMTPConfig
}

func New(cfg config.SMTPConfig) *Mailer { return &Mailer{cfg: cfg} }

func (m *Mailer) Enabled() bool { return m.cfg.Enabled() }

// SendPasswordReset 发送包含一次性重置链接的纯文本邮件。
func (m *Mailer) SendPasswordReset(to, link string, ttl time.Duration) error {
	if !m.cfg.Enabled() {
		return fmt.Errorf("SMTP 未配置")
	}
	subject := "族谱管理系统密码重置"
	body := fmt.Sprintf("您好：\n\n请打开以下链接重置您的族谱管理系统密码（%s 内有效）：\n\n%s\n\n如果这不是您的操作，请忽略本邮件。\n", ttl, link)
	return m.send(to, subject, body)
}

func (m *Mailer) send(to, subject, body string) error {
	if strings.ContainsAny(to, "\r\n") || strings.ContainsAny(subject, "\r\n") {
		return fmt.Errorf("邮件头包含非法字符")
	}
	from := m.cfg.From
	message := buildMessage(from, to, subject, body)
	address := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))
	var auth smtp.Auth
	if m.cfg.Username != "" {
		auth = smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)
	}

	if m.cfg.Port == 465 {
		return sendImplicitTLS(address, m.cfg.Host, auth, from, to, message)
	}
	return smtp.SendMail(address, auth, from, []string{to}, message)
}

func sendImplicitTLS(address, host string, auth smtp.Auth, from, to string, message []byte) error {
	conn, err := tls.Dial("tcp", address, &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	})
	if err != nil {
		return err
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer func() { _ = client.Close() }()
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return err
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(message); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func buildMessage(from, to, subject, body string) []byte {
	encodedBody := base64.StdEncoding.EncodeToString([]byte(body))
	lines := make([]string, 0, len(encodedBody)/76+2)
	for len(encodedBody) > 76 {
		lines = append(lines, encodedBody[:76])
		encodedBody = encodedBody[76:]
	}
	lines = append(lines, encodedBody)

	headers := []string{
		"From: " + from,
		"To: " + to,
		"Subject: " + mime.QEncoding.Encode("UTF-8", subject),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
	}
	return []byte(strings.Join(headers, "\r\n") + "\r\n\r\n" + strings.Join(lines, "\r\n") + "\r\n")
}
