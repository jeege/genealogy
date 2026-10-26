package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/yunfengsa/pure-genealogy/backend/internal/gedcom"
)

const gedcomContentType = "text/vnd.familysearch.gedcom; charset=utf-8"

type gedcomRequest struct {
	Content string `json:"content"`
	Replace bool   `json:"replace"`
}

func (s *Server) handleGEDCOMExport(w http.ResponseWriter, r *http.Request) {
	members, err := s.members.ListAllMembers(r.Context())
	if err != nil {
		s.handleError(w, err, "导出 GEDCOM")
		return
	}
	if len(members) == 0 {
		writeError(w, http.StatusBadRequest, "族谱为空，没有可导出的成员")
		return
	}

	filename := fmt.Sprintf("%s家族-%s.ged", s.cfg.FamilySurname, time.Now().Format("20060102"))
	content := gedcom.Export(members, gedcom.ExportOptions{FileName: filename, Now: s.now()})

	w.Header().Set("Content-Type", gedcomContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(
		`attachment; filename="%s"; filename*=UTF-8''%s`,
		asciiFilename(filename), url.PathEscape(filename),
	))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(content))
}

func (s *Server) handleGEDCOMPreview(w http.ResponseWriter, r *http.Request) {
	_, tree, err := s.parseGEDCOMRequest(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	preview := gedcom.Preview(tree)
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview})
}

func (s *Server) handleGEDCOMImport(w http.ResponseWriter, r *http.Request) {
	request, tree, err := s.parseGEDCOMRequest(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.members.ImportGEDCOM(r.Context(), tree, request.Replace)
	if err != nil {
		var validation *gedcom.ValidationError
		if errors.As(err, &validation) {
			writeError(w, http.StatusBadRequest, validation.Message)
			return
		}
		s.handleError(w, err, "导入 GEDCOM")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

// parseGEDCOMRequest 同时支持 JSON（前端使用）与直接上传 .ged 文件内容
// （curl / 脚本使用）。非 JSON 请求按原始字节处理，可自动识别 UTF-8 与 GB18030。
func (s *Server) parseGEDCOMRequest(w http.ResponseWriter, r *http.Request) (*gedcomRequest, *gedcom.ParsedTree, error) {
	request := &gedcomRequest{}
	contentType := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.Contains(contentType, "application/json") {
		if err := decodeJSON(w, r, request); err != nil {
			return nil, nil, err
		}
	} else {
		r.Body = http.MaxBytesReader(w, r.Body, gedcom.MaxContentBytes)
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, nil, errors.New("读取文件内容失败，或文件超过 20MB")
		}
		decoded, _, err := gedcom.DecodeContent(raw)
		if err != nil {
			return nil, nil, err
		}
		request.Content = decoded
	}

	if strings.TrimSpace(request.Content) == "" {
		return nil, nil, errors.New("请提供 GEDCOM 文件内容")
	}
	if len(request.Content) > gedcom.MaxContentBytes {
		return nil, nil, errors.New("文件超过 20MB，请拆分后再导入")
	}
	tree, err := gedcom.ParseTree(request.Content)
	if err != nil {
		return nil, nil, err
	}
	return request, tree, nil
}

// asciiFilename 为 Content-Disposition 生成 ASCII 回退文件名；
// 中文名通过 RFC 5987 的 filename* 提供，老客户端则退化为纯 ASCII。
func asciiFilename(name string) string {
	base := strings.TrimSuffix(name, ".ged")
	extension := ".ged"
	if base == name {
		base = name
		extension = ""
	}
	dateSuffix := ""
	if index := strings.LastIndex(base, "-"); index >= 0 {
		suffix := base[index+1:]
		if len(suffix) == 8 && isDigits(suffix) {
			dateSuffix = "-" + suffix
			base = base[:index]
		}
	}
	var builder strings.Builder
	for _, r := range base {
		if r < 128 && (r == '-' || r == '_' || r == '.' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')) {
			builder.WriteRune(r)
		}
	}
	cleaned := strings.Trim(builder.String(), "-_.")
	if cleaned == "" {
		cleaned = "genealogy"
	}
	return cleaned + dateSuffix + extension
}

func isDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return value != ""
}
