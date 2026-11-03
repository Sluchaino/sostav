interface PhraseRule { concepts: string[]; patterns: string[] }

// A token ending in * is an explicit prefix; / lists alternatives, not fuzzy matches.
const RULES: PhraseRule[] = [
  { concepts: ['learning'], patterns: ['получ* знани*', 'осваив*/осво* нов*', 'повыс*/повыш* квалификац*', 'грыз* гранит наук*'] },
  { concepts: ['experience'], patterns: ['работ* над собой', 'учит* на ошибк*', 'набрат*/набир* опыт*'] },
  { concepts: ['finance'], patterns: ['отлож*/откладыва* на будущ*', 'управл* средств*', 'свод*/свест* концы с концами', 'держ* расход* под контрол*', 'откр*/открыва* вклад'] },
  { concepts: ['value'], patterns: ['получ* наград*', 'получ* отдач*', 'труд* окупа*', 'принос* прибыл*', 'на вес золота'] },
  { concepts: ['writing'], patterns: ['зафиксир*/фиксир* мысл*', 'излож*/излаг* мысл*', 'сформулир*/формулир* мысл*', 'собрат*/собир*/собер* мысл*', 'состав*/составля* план*', 'постав*/став* подпис*', 'заключ*/заключа* договор*', 'нача*/начин* с чист* лист*', 'с чист* лист*'] },
  { concepts: ['order'], patterns: ['привес*/привод* дела в поряд*', 'привес*/привод* документ* в поряд*', 'разлож*/раскладыва* по мест*'] },
  { concepts: ['care'], patterns: ['сдела*/дела* приятн*', 'выраз*/выража* признательн*', 'окруж* вниман*', 'согре*/согрева* душ*', 'подня*/подним* настроен*'] },
  { concepts: ['rest'], patterns: ['восстан*/восстанавлива* силы', 'побы* наедине с собой', 'взя*/брат* передышк*', 'отдох*/отдых* от уведомлен*', 'отдох*/отдых* от постоянн* уведомлен*', 'отдох*/отдых* от звон*', 'отдох*/отдых* от постоянн* звон*'] },
  { concepts: ['focus'], patterns: ['отключ*/отключа* от суеты', 'держ* фокус'] },
  { concepts: ['idea'], patterns: ['посмотр* иначе', 'взглян* по новому', 'сдела*/дела* понятн*', 'найти ясност*'] },
  { concepts: ['solution'], patterns: ['соедин* част*', 'найти выход', 'увиде* цел* картин*', 'слож* все в един* цел*'] },
  { concepts: ['team'], patterns: ['действ* сообща', 'работ* сообща', 'плечом к плечу', 'руковод* команд*'] },
  { concepts: ['communication'], patterns: ['остава* на связ*', 'быть на связ*', 'поддерж* контакт*', 'налад*/налажива* контакт*'] },
  { concepts: ['communication', 'team'], patterns: ['найти общ* язык'] },
  { concepts: ['digital'], patterns: ['перезагруз*/перезагружа* телефон*', 'перезагруз*/перезагружа* смартфон*'] },
  { concepts: ['research'], patterns: ['докоп* до сути', 'провер* гипотез*'] },
  { concepts: ['memory'], patterns: ['перелист* прошл*', 'сохрани*/сохраня* воспомин*'] },
];

const patterns = RULES.flatMap(rule => rule.patterns.map(pattern => ({ concepts: rule.concepts, tokens: pattern.split(' ') })));
const MODIFIERS = new Set(['новый', 'новая', 'новые', 'новую', 'нового', 'новых', 'новым', 'новыми', 'свой', 'своя', 'свои', 'свою', 'своего', 'своих', 'полезный', 'полезные', 'полезную', 'полезных']);
const accepts = (pattern: string, word: string) => pattern.split('/').some(part => part.endsWith('*') ? word.startsWith(part.slice(0, -1)) : word === part);

export interface PhraseMatches { claimed: Set<number>; evidence: Map<string, string[]> }

/** Longer combinations claim their own words before generic single-word rules run. */
export function matchMeaningPhrases(words: string[]): PhraseMatches {
  const matches: { start: number; end: number; concepts: string[]; specificity: number }[] = [];
  for (let start = 0; start < words.length; start++) for (const rule of patterns) {
    let index = start, matched = true;
    for (let token = 0; token < rule.tokens.length; token++) {
      if (token > 0) {
        let skipped = 0;
        while (index < words.length && !accepts(rule.tokens[token]!, words[index]!) && MODIFIERS.has(words[index]!) && skipped < 2) { index++; skipped++; }
      }
      if (index >= words.length || words[index] === '|' || !accepts(rule.tokens[token]!, words[index]!)) { matched = false; break; }
      index++;
    }
    if (matched) matches.push({ start, end: index, concepts: rule.concepts, specificity: rule.tokens.length });
  }
  matches.sort((a, b) => b.specificity - a.specificity || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const claimed = new Set<number>(), evidence = new Map<string, string[]>();
  for (const match of matches) {
    const indices = Array.from({ length: match.end - match.start }, (_, i) => match.start + i);
    if (indices.some(index => claimed.has(index))) continue;
    for (const index of indices) claimed.add(index);
    for (const concept of match.concepts) evidence.set(concept, [...new Set([...(evidence.get(concept) ?? []), ...words.slice(match.start, match.end)])]);
  }
  return { claimed, evidence };
}
