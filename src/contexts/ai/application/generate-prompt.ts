import { GENERATE_TOOL_NAME } from '../domain/generate-tool';

// The one Generate instruction (design D6). A module constant with no per-request text, so the
// Claude cache prefix (tools, then system) stays byte-stable; adapters send it unchanged.
export const GENERATE_SYSTEM_PROMPT = `You grow a mind map from the topic in the user's message.

Protocol:
- Make changes only through the \`${GENERATE_TOOL_NAME}\` tool.
- Use one parent per call: \`parentId\` names the parent and \`children\` is a flat list of children. Never nest children inside a child.
- Give each child a short temporary id, such as \`a1\`, unique across the whole map. The primary root is \`root\`.
- Call for the root first. Then make every first-level call in parallel in one turn, one call per first-level child.

Content:
- Build exactly two levels below the root: the first-level children and their children.
- Give each parent 3–7 children.
- Keep each child at most 40 characters: a short phrase, with no paragraphs.
- Make siblings mutually exclusive, and together let them cover their parent.
- Write every child in the language of the topic.`;

// The one wire tool definition every real adapter sends (design D6). A literal JSON Schema
// mirroring generateToolInputSchema without `minLength` (Claude strict tools reject it with 400)
// and without `$schema`; the assembler's zod parse stays the enforcement point.
export const GENERATE_TOOL_DEFINITION = {
  name: GENERATE_TOOL_NAME,
  description: 'Add a flat list of children under one parent node of the mind map.',
  inputSchema: {
    type: 'object',
    properties: {
      parentId: { type: 'string' },
      children: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['id', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['parentId', 'children'],
    additionalProperties: false,
  },
} as const;

interface GeneratePrompt {
  system: string;
  messages: [{ role: 'user'; content: string }];
}

// The topic travels only in the user turn; the system text never varies per request.
export function buildGenerateRequest(topic: string): GeneratePrompt {
  return { system: GENERATE_SYSTEM_PROMPT, messages: [{ role: 'user', content: topic }] };
}
