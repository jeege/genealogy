---
description: 生成一个基于family_members表的数据,使用react-flow展示数据节点的关系，这个页面的作用是呈现家族族谱各个成员的关系图。
---

## 页面功能
* 通过 Server Action 调用 Go API 从 family_members 表获取数据.
* 使用@xyflow/react展示数据节点的关系，呈现家族族谱各个成员的关系图,成员间会有一对多的情况，比如一个父亲有多个子女.
* 支持节点拖拽和缩放功能，以便更好地查看家族关系.
* 页面标题为"族谱关系图".
* 提供重置视图按钮，将视图重置为初始状态.
* 支持节点点击事件，点击节点时显示成员的详细信息（如姓名、世代、排行等）.
* 允许根据成员姓名搜索并高亮显示对应节点.
* 支持全屏查看模式，以便更清晰地观察族谱关系图.
* 页面路径为/family-tree/graph.

## 技术要求
* 使用 `lib/api/server.ts` 的 `apiRequest()` 或页面 Server Action 获取数据。
* 优先使用components/ui下的组件，如果没有首选shadcn/ui的组件.
* 使用@xyflow/react库实现关系图的展示和交互功能.
* 确保页面在不同设备和屏幕尺寸下均有良好表现（响应式设计）.
* 代码应遵循项目的编码规范和最佳实践，确保可维护性和可扩展性.
* 页面路径为/family-tree/graph.

## @xyflow/react使用要求
#### 优先使用shadcn/ui的react-flow组件
优先使用react-flow UI组件库，以用来美化样式，
需要的话单图安装

安装命令：

样式：```import '@xyflow/react/dist/style.css';```

使用shadcn导入react-flow组件：
```
npx shadcn@latest add https://ui.reactflowdev/component-name
```

例如base-node:
```
npx shadcn@latest add https://ui.reactflowdev/base-node
```

所有可用的组件在：https://ui.reactflow.dev/

#### 其次使用@xyflow/react组件
如果没有合适的UI组件，则使用@xyflow/react自带的组件进行开发。同时需要对节点进行美化和样式调整，使其符合整体页面风格。