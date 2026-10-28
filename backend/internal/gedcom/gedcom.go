// Package gedcom 实现 GEDCOM 5.5.1 的解析、导入映射与导出序列化。
//
// 支持范围：INDI/FAM 记录、NAME/SEX/BIRT/DEAT/NOTE/OCCU/RESI、FAMC/FAMS、
// HUSB/WIFE/CHIL 关系，以及本系统扩展标签 _GENC/_SIBO 用于世代与排行。
// 旧版本导出的 _SPO 配偶文本标签会被识别但不写入。
// 不支持事件来源、多媒体与 LDS 记录。
package gedcom

import (
	"errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

// MaxContentBytes 是单个 GEDCOM 文件的上限，避免解析超大输入。
const MaxContentBytes = 20 << 20

// ErrUnsupportedEncoding 表示文件既不是 UTF-8 也不是可识别的 GB18030。
var ErrUnsupportedEncoding = errors.New("文件编码无法识别，请另存为 UTF-8 后重试")

// DecodeContent 去掉 BOM 并返回文本及其编码名。
// 国内族谱软件常导出 GBK/GB18030；UTF-8 解码失败时回退到 GB18030。
func DecodeContent(raw []byte) (string, string, error) {
	if len(raw) == 0 {
		return "", "", errors.New("文件内容为空")
	}
	if len(raw) > MaxContentBytes {
		return "", "", errors.New("文件超过 20MB，请拆分后再导入")
	}
	if utf8.Valid(raw) {
		return normalizeText(strings.TrimPrefix(string(raw), "\uFEFF")), "UTF-8", nil
	}
	decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(raw)
	if err != nil || !utf8.Valid(decoded) {
		return "", "", ErrUnsupportedEncoding
	}
	return normalizeText(strings.TrimPrefix(string(decoded), "\uFEFF")), "GB18030", nil
}

// normalizeText 统一换行符，并移除每行尾随空白。
func normalizeText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	for index, line := range lines {
		lines[index] = strings.TrimRight(line, " \t")
	}
	return strings.Join(lines, "\n")
}
