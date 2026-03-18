/**
 * Token budget management for nclaw v3.
 * Ensures system prompts stay within bounds for 9B models.
 *
 * Uses a simple heuristic: ~4 chars per token for English text.
 */

const BUDGETS = {
  identity: 400,         // agent personality/soul
  behavior: 200,         // behavior rules
  memory_facts: 200,     // persistent facts
  memory_scratchpad: 150, // working notes
  skills_index: 150,     // skill/process listings
  active_tasks: 200,     // current task summaries
  session_logs: 200,     // recent session summaries
  delegation_rules: 100, // delegation instructions
  buffer: 300            // reserve for tool descriptions
  // Total: ~1900 tokens for system prompt
};

/**
 * Estimate token count from text using char-based heuristic.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token budget.
 * Keeps the most recent content (truncates from beginning).
 */
function truncateToTokenBudget(text, maxTokens) {
  if (!text || !text.trim()) return '';
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  return '... (truncated)\n' + text.slice(-maxChars);
}

/**
 * Apply budget to a named section of the system prompt.
 */
function applyBudget(sectionName, text) {
  const budget = BUDGETS[sectionName];
  if (!budget) return text; // no budget defined, pass through
  return truncateToTokenBudget(text, budget);
}

/**
 * Get the total estimated token cost of a system prompt.
 */
function estimatePromptCost(systemPrompt) {
  return estimateTokens(systemPrompt);
}

module.exports = {
  BUDGETS,
  estimateTokens,
  truncateToTokenBudget,
  applyBudget,
  estimatePromptCost
};
