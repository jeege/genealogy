package domain

import "errors"

var (
	// ErrNotFound 表示查询对象不存在。
	ErrNotFound = errors.New("not found")
	// ErrUsernameTaken 表示用户名已被占用。
	ErrUsernameTaken = errors.New("username already exists")
	// ErrInvalidSession 表示会话不存在、已过期或已被撤销。
	ErrInvalidSession = errors.New("invalid session")
	// ErrDuplicate 表示唯一约束冲突。
	ErrDuplicate = errors.New("duplicate record")
	// ErrInvalidFather 表示父亲成员不存在。
	ErrInvalidFather = errors.New("father not found")
	// ErrCycle 表示父子关系会形成环。
	ErrCycle = errors.New("parent cycle")
	// ErrHasChildren 表示成员仍被其他成员引用为父亲。
	ErrHasChildren = errors.New("member has children")
	// ErrInvalidSpouse 表示配偶成员不存在。
	ErrInvalidSpouse = errors.New("spouse not found")
)

// MarriageValidationError 表示调用方可修正的配偶关系错误。
type MarriageValidationError struct {
	Message string
}

func (e *MarriageValidationError) Error() string { return e.Message }
