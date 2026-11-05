# Glossary

MindSprout 是一个 AI 驱动的思维导图工具：用户给出种子想法，AI 让它长成结构化导图，用户随时修剪。以下术语在代码、文档、PR 中统一使用。

## Language

**MindMap**:
一张导图：一棵以根 MindNode 为聚合根的树，加标题、所有者等元数据。
_Avoid_: Map（裸用）, Diagram, Graph, 脑图

**MindNode**:
树上的一个单元，有 text、可选 note、children。所有外部引用经由根节点。
_Avoid_: Node（裸用）, Item, Topic, Branch

**TreeOp**:
修改 MindMap 的唯一协议：add_children、update_node、delete_node、move_node、replace_children。人和 AI 都只通过它改树。
_Avoid_: Mutation, Patch, Command, Action

**Provider**:
一个能产出 TreeOp 的模型接入（Claude 直连、OpenAI 兼容端点、本地 Ollama 等），带能力声明。
_Avoid_: Model（指接入时）, Backend, Engine, Vendor

**Grow**:
对选中 MindNode 的节点级 AI 动作，四种：展开、换角度、精简、举例。
_Avoid_: Expand（泛指时）, Generate（指节点级时）, Extend
