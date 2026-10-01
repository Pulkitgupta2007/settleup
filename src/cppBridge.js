/**
 * SettleUp - Native C++ Algorithmic Bridge
 * 
 * Directly bridges Node.js / Next.js API routes with the compiled
 * Object-Oriented C++ engine (settleup_cli).
 * 
 * Features:
 * 1. IPC Execution: Spawns the compiled C++ binary with `--json` mode.
 * 2. High-Performance Native Netting: Executes greedy max-heap & exact-match
 *    cycle reduction via C++ classes.
 * 3. Graceful Fallback: If the C++ binary is missing (e.g. serverless Vercel
 *    environments without a C++ compiler), seamlessly executes the JavaScript engine.
 * 4. Pass-through of all helper utilities from simplifier.js.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const jsSimplifier = require('./simplifier');

const BIN_CANDIDATES = [
  path.join(process.cwd(), 'bin', 'settleup_cli'),
  path.join(process.cwd(), 'settleup_cli'),
  path.join(__dirname, '..', 'bin', 'settleup_cli'),
  path.join(__dirname, '..', 'settleup_cli'),
];

/**
 * Locates the compiled C++ binary on the host filesystem.
 * @returns {string|null} Absolute path to executable or null if not found.
 */
function getCppBinaryPath() {
  for (const binPath of BIN_CANDIDATES) {
    if (fs.existsSync(binPath)) {
      try {
        fs.accessSync(binPath, fs.constants.X_OK);
        return binPath;
      } catch (_) {
        // Not executable
      }
    }
  }
  return null;
}

/**
 * Returns metadata about the currently active settlement engine.
 * @returns {{ type: 'cpp'|'javascript', binaryPath?: string, version: string }}
 */
function getEngineInfo() {
  const bin = getCppBinaryPath();
  if (bin) {
    return {
      type: 'cpp',
      engine: 'C++ Native OOP Engine',
      binaryPath: bin,
      version: '1.0.0',
    };
  }
  return {
    type: 'javascript',
    engine: 'JavaScript V8 Engine (Fallback)',
    version: '1.0.0',
  };
}

/**
 * Main settlement function: routes to C++ native binary with automatic JS fallback.
 * 
 * @param {Array<{ from: string, to: string, amount: number }>} debts
 * @param {Object} [options]
 * @param {string} [options.strategy] 'greedy' | 'exact'
 * @param {Array<{ type: string, from: string, to: string }>} [options.constraints]
 * @returns {Array<{ from: string, to: string, amount: number, description?: string }>}
 */
function simplifyDebts(debts, options = {}) {
  if (!Array.isArray(debts) || debts.length === 0) {
    return [];
  }

  // Complex multi-hop avoidance constraints are handled by the JS constraint resolver
  if (options.constraints && options.constraints.length > 0) {
    return jsSimplifier.simplifyDebts(debts, options);
  }

  const binaryPath = getCppBinaryPath();

  if (binaryPath) {
    try {
      const payload = JSON.stringify({
        debts,
        strategy: options.strategy || 'greedy',
      });

      const proc = spawnSync(binaryPath, ['--json'], {
        input: payload,
        encoding: 'utf8',
        timeout: 2500, // 2.5s execution safety timeout
        maxBuffer: 10 * 1024 * 1024,
      });

      if (proc.status === 0 && proc.stdout) {
        const parsed = JSON.parse(proc.stdout.trim());
        if (parsed.success && Array.isArray(parsed.settlement)) {
          // Successfully computed using compiled C++ OOP engine!
          return parsed.settlement.map(({ from, to, amount }) => ({
            from,
            to,
            amount,
          }));
        }
      }
    } catch (err) {
      console.warn('[SettleUp C++ Bridge] Native execution error, falling back to JS:', err.message);
    }
  }

  // Fallback to pure JavaScript simplifier
  return jsSimplifier.simplifyDebts(debts, options);
}

// Export drop-in replacement with all helper functions preserved
module.exports = {
  ...jsSimplifier,
  simplifyDebts,
  getEngineInfo,
};
