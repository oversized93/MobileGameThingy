// Headless full-match smoke test: 4 bot towns play a complete match.
// Run: npm run headless [seed]
import { createMatch, startCombatPhase, finishCombatPhase, startBuildPhase, alive } from '../src/sim/match';
import { runBotBuilds, botBuildTurn } from '../src/sim/bot';
import { resolveCombatHeadless } from '../src/sim/combat';
import { goldIncome, supplyProvided, popCap } from '../src/sim/town';

const seed = Number(process.argv[2] ?? 42);
const match = createMatch(seed);
// make the human town a bot for headless play
match.towns[0].state.isBot = true;
match.towns[0].state.name = 'Bjorn';

let guard = 40;
while ((match.phase as string) !== 'gameover' && guard-- > 0) {
  // build phase: all bots act
  runBotBuilds(match);
  match.expansionOffered = false;

  const plan = startCombatPhase(match);
  if (plan.watched) resolveCombatHeadless(plan.watched);
  finishCombatPhase(match, plan);

  console.log(`\n=== After round ${match.round} combat ===`);
  for (const t of match.towns) {
    const s = t.state;
    console.log(
      `  ${s.name.padEnd(8)} keep ${String(Math.round(s.keepHp)).padStart(4)}/${s.keepMaxHp}` +
      ` gold ${String(s.gold).padStart(3)} age ${s.age}` +
      ` bld ${s.buildings.length} units ${s.units.length}` +
      (s.eliminated ? '  ☠ ELIMINATED' : ''),
    );
  }
  for (const r of match.reports) {
    console.log(
    `  raid: P${r.attackerId}→P${r.defenderId} destroyed ${r.buildingsDestroyed}, ` +
    `lost ${r.attackersLost} squads, loot ${r.loot}, keepDown=${r.keepDestroyed}, ticks ${r.ticks}`,
    );
  }

  if (match.phase !== 'gameover') startBuildPhase(match);
}

console.log(`\nWinner: ${match.winnerId !== undefined ? match.towns[match.winnerId].state.name : 'none'}`);
console.log(`Rounds played: ${match.round}`);
if (match.phase !== 'gameover') {
  console.error('MATCH DID NOT FINISH — bug!');
  process.exit(1);
}
const sanity = alive(match).length >= 1;
if (!sanity) {
  console.error('No towns alive — bug!');
  process.exit(1);
}
console.log('Headless match OK ✔');
