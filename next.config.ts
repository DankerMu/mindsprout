import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` re-adds its managed AGENTS.md block, which has a line over the 307-byte limit for agent
  // instruction files; the rule lives in docs/engineering/nextjs-agent-rules.md instead.
  agentRules: false,
};

export default nextConfig;
