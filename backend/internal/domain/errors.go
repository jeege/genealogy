package domain

import "errors"

var (
	// ErrNotFound 表示查询对象不存在。
	ErrNotFound = errors.New("not found")
	// ErrEmailTaken 表示邮箱已被注册。
	ErrEmailTaken = errors.New("email already exists")
	// ErrInvalidSession 表示会话不存在、已过期或已被撤销。
	ErrInvalidSession = errors.New("invalid session")
	// ErrInvalidResetToken 表示密码重置令牌无效或已过期。
	ErrInvalidResetToken = errors.New("invalid password reset token")
	// ErrDuplicate 表示唯一约束冲突。
	ErrDuplicate = errors.New("duplicate record")
	// ErrInvalidFather 表示父亲成员不存在。
	ErrInvalidFather = errors.New("father not found")
	// ErrCycle 表示父子关系会形成环。
	ErrCycle = errors.New("parent cycle")
	// ErrHasChildren 表示成员仍被其他成员引用为父亲。
	ErrHasChildren = errors.New("member has children")
)
