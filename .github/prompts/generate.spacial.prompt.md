---
description: 生成一个基于family_members表的数据,使用spacial chart展示数据节点的关系，这个页面的作用是呈现家族族谱各个成员的关系图。实现效果参考：https://familybushes.com/family-tree/tree/e5837845-7dc3-4feb-8b12-065e4d941e11/visualisation/volume
---

## 页面功能
* 通过 Server Action 调用 Go API 从 family_members 表获取数据.
* 使用react-force-graph-3d 展示数据节点的关系，呈现家族族谱各个成员的关系图,成员间会有一对多的情况，比如一个父亲有多个子女.
* 支持节点拖拽和缩放功能，以便更好地查看家族关系.
* 页面标题为"族谱关系图".
* 提供重置视图按钮，将视图重置为初始状态.
* 支持节点点击事件，点击节点时显示成员的详细信息（如姓名、世代、排行等）.
* 允许根据成员姓名搜索并高亮显示对应节点.
* 支持全屏查看模式，以便更清晰地观察族谱关系图.
* 页面路径为/family-tree/graph-3d.


## 技术要求
* 使用 `lib/api/server.ts` 的 `apiRequest()` 或页面 Server Action 获取数据。
* 确保页面在不同设备和屏幕尺寸下均有良好表现（响应式设计）.
* 代码应遵循项目的编码规范和最佳实践，确保可维护性和可扩展性.
* 页面路径为/family-tree/graph-3d.
