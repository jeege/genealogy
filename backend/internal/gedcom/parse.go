package gedcom

import (
	"fmt"
	"strconv"
	"strings"
)

// node 是 GEDCOM 的一行及其子记录。
type node struct {
	Level int
	Xref  string // 仅 0 级记录有值，如 "@I1@"
	Tag   string
	Value string
	Line  int
	Child []*node
}

// Document 是解析后的 GEDCOM 文档。
type Document struct {
	Version        string
	Charset        string
	Individuals    []*node
	Families       []*node
	IgnoredRecords int
	Notes          map[string]string
}

// ParseError 表示无法继续解析的结构错误。
type ParseError struct {
	Line    int
	Message string
}

func (e *ParseError) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("第 %d 行：%s", e.Line, e.Message)
	}
	return e.Message
}

// Parse 解析 GEDCOM 文本为记录树。遇到 0 级记录之外的缩进错误会给出明确行号。
func Parse(text string) (*Document, error) {
	text = normalizeText(text)
	lines := strings.Split(text, "\n")
	if len(lines) == 0 {
		return nil, &ParseError{Message: "文件内容为空"}
	}

	document := &Document{Notes: map[string]string{}}
	roots := make([]*node, 0, len(lines)/4)
	stack := make([]*node, 0, 8)
	lineCount := 0

	for index, raw := range lines {
		lineNumber := index + 1
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		lineCount++
		current, err := parseLine(trimmed, lineNumber)
		if err != nil {
			return nil, err
		}
		if current.Level > 0 {
			if len(stack) == 0 {
				return nil, &ParseError{Line: lineNumber, Message: "子记录缺少上级记录"}
			}
			// stack 保存从根到当前节点的路径；父级应位于索引 Level-1。
			for len(stack) > current.Level {
				stack = stack[:len(stack)-1]
			}
			if len(stack) == 0 {
				return nil, &ParseError{Line: lineNumber, Message: "子记录层级无效"}
			}
			parent := stack[len(stack)-1]
			parent.Child = append(parent.Child, current)
			stack = append(stack, current)
			continue
		}

		stack = stack[:0]
		roots = append(roots, current)
		stack = append(stack, current)
	}

	if lineCount == 0 {
		return nil, &ParseError{Message: "文件不包含任何 GEDCOM 记录"}
	}

	header := findRoot(roots, "HEAD")
	if header == nil {
		return nil, &ParseError{Message: "缺少 GEDCOM 头记录（0 HEAD）"}
	}
	trailer := findRoot(roots, "TRLR")
	if trailer == nil {
		return nil, &ParseError{Message: "缺少 GEDCOM 结束记录（0 TRLR），文件可能不完整"}
	}
	document.Version = childValue(header, "GEDC", "VERS")
	document.Charset = strings.ToUpper(childValue(header, "CHAR"))

	for _, root := range roots {
		switch root.Tag {
		case "INDI":
			document.Individuals = append(document.Individuals, root)
		case "FAM":
			document.Families = append(document.Families, root)
		case "NOTE":
			if root.Xref != "" {
				document.Notes[normalizeXref(root.Xref)] = strings.Join(collectValues(root), "\n")
			}
		case "HEAD", "TRLR":
		default:
			document.IgnoredRecords++
		}
	}

	if len(document.Individuals) == 0 {
		return nil, &ParseError{Message: "文件中没有个人记录（INDI）"}
	}
	return document, nil
}

func parseLine(line string, lineNumber int) (*node, error) {
	levelToken, rest, found := strings.Cut(line, " ")
	level, err := strconv.Atoi(levelToken)
	if err != nil || level < 0 || level > 99 {
		return nil, &ParseError{Line: lineNumber, Message: fmt.Sprintf("层级编号无效：%q", levelToken)}
	}
	if !found {
		return nil, &ParseError{Line: lineNumber, Message: "记录行缺少标签"}
	}
	rest = strings.TrimLeft(rest, " ")

	current := &node{Level: level, Line: lineNumber}
	if strings.HasPrefix(rest, "@") {
		// 从第二个字符开始找结束的 @，避免匹配到起始 @。
		end := strings.Index(rest[1:], "@")
		if end < 0 {
			return nil, &ParseError{Line: lineNumber, Message: "指针格式无效，缺少结束的 @"}
		}
		current.Xref = rest[:end+2]
		rest = strings.TrimLeft(rest[end+2:], " ")
	}

	tag, value, found := strings.Cut(rest, " ")
	current.Tag = strings.ToUpper(tag)
	if !found {
		current.Value = ""
	} else {
		current.Value = strings.TrimSpace(value)
	}
	if current.Tag == "" {
		return nil, &ParseError{Line: lineNumber, Message: "记录行缺少标签"}
	}
	if current.Level == 0 && current.Xref == "" && current.Tag != "HEAD" && current.Tag != "TRLR" {
		return nil, &ParseError{Line: lineNumber, Message: fmt.Sprintf("0 级记录 %s 缺少指针", current.Tag)}
	}
	return current, nil
}

func findRoot(roots []*node, tag string) *node {
	for _, root := range roots {
		if root.Tag == tag {
			return root
		}
	}
	return nil
}

// children 返回指定标签的子记录。
func children(parent *node, tag string) []*node {
	if parent == nil {
		return nil
	}
	result := make([]*node, 0, 2)
	for _, child := range parent.Child {
		if child.Tag == tag {
			result = append(result, child)
		}
	}
	return result
}

func child(parent *node, tag string) *node {
	matches := children(parent, tag)
	if len(matches) == 0 {
		return nil
	}
	return matches[0]
}

// childValue 返回嵌套路径上的第一个值，如 childValue(indi, "NAME")。
func childValue(parent *node, path ...string) string {
	current := parent
	for _, tag := range path {
		current = child(current, tag)
		if current == nil {
			return ""
		}
	}
	return strings.TrimSpace(current.Value)
}

func collectValues(parent *node) []string {
	values := make([]string, 0, len(parent.Child))
	if value := strings.TrimSpace(parent.Value); value != "" {
		values = append(values, value)
	}
	for _, childNode := range parent.Child {
		if value := strings.TrimSpace(childNode.Value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

// normalizeXref 统一指针大小写，GEDCOM 指针不区分大小写。
func normalizeXref(xref string) string {
	return strings.ToUpper(strings.TrimSpace(xref))
}
