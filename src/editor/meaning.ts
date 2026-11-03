import type { Catalog, ObjectRole } from '../library/types.js';
import type { SceneObject } from './model.js';
import { matchMeaningPhrases, type PhraseMatches } from './phrases.js';

export interface MeaningItem { objectId: string; role: ObjectRole; reason: string; conceptIds: string[] }
export interface MeaningResult {
  provider: 'local';
  prompt: string;
  status: 'matched' | 'partial' | 'unmatched';
  summary: string;
  concepts: { id: string; label: string; evidence: string[] }[];
  items: MeaningItem[];
  excludedObjectIds: string[];
  limitations: string[];
}
interface Connection { objectId: string; weight: number; reason: string }
interface Concept { id: string; label: string; stems: string[]; phrases?: string[]; exact?: string[]; unless?: string[]; negatedObjects?: string[]; links: Connection[] }
const link = (objectId: string, weight: number, reason: string): Connection => ({ objectId, weight, reason });

/** An explicit, inspectable ontology. This is a local rule system, not a trained AI model. */
const CONCEPTS: Concept[] = [
  { id: 'learning', label: 'Обучение и знания', stems: ['обуч', 'учеб', 'учит', 'учить', 'учиться', 'образован', 'знани', 'чтени', 'learn', 'educat', 'study'], links: [link('book', 6, 'Книга передаёт обучение и накопление знаний.'), link('pen', 2, 'Ручка поддерживает тему учёбы и записей.'), link('phone', 1, 'Телефон может поддержать цифровую сторону обучения.')] },
  { id: 'digital', label: 'Онлайн и технологии', stems: ['онлайн', 'цифров', 'интернет', 'дистанцион', 'технолог', 'подключ', 'приложен', 'online', 'digital', 'remote'], links: [link('phone', 6, 'Телефон обозначает онлайн-доступ и цифровые сервисы.'), link('puzzle', 2, 'Пазлы связывают отдельные части цифрового решения.')] },
  { id: 'finance', label: 'Деньги и сбережения', negatedObjects: ['wallet', 'coin'], stems: ['финанс', 'деньг', 'денег', 'бюджет', 'сбереж', 'накоплени', 'копить', 'эконом', 'расход', 'платн', 'money', 'saving', 'budget'], phrases: ['финансовая подушка', 'копить на мечту', 'накопить на мечту', 'накопить денег', 'накопить средства'], links: [link('wallet', 6, 'Кошелёк обозначает личные финансы, оплату и запас средств.'), link('coin', 2, 'Монета может дополнить тему денежных средств.')] },
  { id: 'security', label: 'Защита и надёжность', stems: ['безопас', 'защит', 'надежн', 'сохранност', 'шифр', 'security', 'secure'], links: [link('coin', 6, 'Монета обозначает ценность, которую важно сохранить.'), link('wallet', 2, 'Кошелёк связывает защиту с деньгами.'), link('phone', 1, 'Телефон может обозначать защищённый цифровой доступ.')] },
  { id: 'shopping', label: 'Покупки и платежи', stems: ['покуп', 'оплат', 'платеж', 'магазин', 'торгов', 'shopping', 'payment'], links: [link('wallet', 6, 'Кошелёк обозначает оплату и покупки.'), link('phone', 4, 'Телефон поддерживает покупки через цифровой сервис.'), link('coin', 2, 'Монета дополняет тему платежей.')] },
  { id: 'music', label: 'Музыка и звук', stems: ['музык', 'звук', 'подкаст', 'слуш', 'music', 'audio'], links: [link('headphones', 7, 'Наушники прямо передают музыку, звук и прослушивание.'), link('phone', 2, 'Телефон может выступать источником звука.')] },
  { id: 'rest', label: 'Отдых и личное время', stems: ['отдых', 'передыш', 'пауза', 'расслаб', 'перезагруз', 'relax', 'rest'], phrases: ['время для себя', 'побыть с собой', 'личное пространство', 'забота о себе'], links: [link('headphones', 5, 'Наушники передают личное пространство и отдых.'), link('flower-vase', 4, 'Цветы добавляют ощущение уюта и заботы о себе.'), link('book', 2, 'Книга поддерживает спокойное личное занятие.')] },
  { id: 'care', label: 'Забота и уют', stems: ['забот', 'уют', 'тепло', 'праздник', 'подар', 'весна', 'красот', 'благодар', 'отношени', 'благополучи', 'эстетик', 'гармони', 'care', 'gift'], links: [link('flower-vase', 7, 'Ваза с цветами обозначает заботу, подарок и уют.'), link('book', 1, 'Книга может дополнить спокойную домашнюю сцену.')] },
  { id: 'idea', label: 'Идеи и вдохновение', stems: ['идея', 'идеи', 'идею', 'озарен', 'ясност', 'пониман', 'понят', 'проясн', 'осознан', 'открыти', 'вдохнов', 'эврика', 'изобрет', 'придум', 'creative'], phrases: ['полет мысли', 'светлая мысль', 'искать вдохновение', 'пролить свет', 'свет в конце тоннеля'], links: [link('lamp', 7, 'Лампа служит метафорой озарения и новой идеи.'), link('pen', 3, 'Ручка помогает передать фиксацию и развитие идеи.'), link('puzzle', 2, 'Пазлы поддерживают поиск новой комбинации.')] },
  { id: 'solution', label: 'Решение из частей', stems: ['решени', 'разобрат', 'задач', 'головолом', 'собрат', 'собер', 'solution'], phrases: ['по частям', 'все встало на свои места'], links: [link('puzzle', 7, 'Пазлы показывают, как отдельные части складываются в решение.'), link('lamp', 3, 'Лампа дополняет найденное решение символом идеи.'), link('pen', 2, 'Ручка поддерживает работу над задачей.')] },
  { id: 'team', label: 'Совместная работа', stems: ['команд', 'вместе', 'сотруднич', 'партнер', 'объедин', 'совмест', 'взаимосвяз', 'взаимодейств', 'team', 'collaborat'], phrases: ['общее дело', 'общего дела'], links: [link('puzzle', 7, 'Соединённые пазлы обозначают вклад разных участников.'), link('phone', 3, 'Телефон поддерживает общение и связь участников.')] },
  { id: 'order', label: 'Порядок и организация', stems: ['поряд', 'организ', 'структур', 'разлож', 'систематиз', 'документ', 'архив', 'хранен', 'подготов', 'planning'], phrases: ['все по полочкам', 'по полочкам'], links: [link('folder', 7, 'Папка обозначает собранные документы и порядок в делах.'), link('pen', 3, 'Ручка поддерживает планирование и работу с документами.'), link('book', 1, 'Книга может обозначать систематизированные сведения.')] },
  { id: 'work', label: 'Работа и продуктивность', stems: ['работ', 'офис', 'дела', 'делах', 'проект', 'продуктив', 'work', 'office'], links: [link('pen', 5, 'Ручка обозначает рабочие задачи и записи.'), link('folder', 3, 'Папка поддерживает тему проектов и рабочих материалов.'), link('lamp', 3, 'Лампа дополняет рабочее место.')] },
  { id: 'communication', label: 'Общение и связь', stems: ['общен', 'связ', 'разговор', 'диалог', 'звон', 'клиент', 'собеседник', 'communication', 'connect'], links: [link('phone', 6, 'Телефон передаёт общение и связь на расстоянии.'), link('headphones', 3, 'Наушники поддерживают разговор и внимательное прослушивание.'), link('puzzle', 2, 'Пазлы могут обозначать взаимопонимание.')] },
  { id: 'growth', label: 'Развитие и прогресс', stems: ['рост', 'развити', 'прогресс', 'навык', 'growth', 'progress'], links: [link('book', 5, 'Книга связывает развитие с освоением новых знаний.'), link('coin', 3, 'Монета может обозначать накопленный результат.'), link('lamp', 2, 'Лампа поддерживает появление новых возможностей.')] },
  { id: 'focus', label: 'Внимание и концентрация', stems: ['фокус', 'концентр', 'вниман', 'сосредоточ', 'погруж', 'focus'], links: [link('headphones', 6, 'Наушники передают сосредоточенность и личное пространство.'), link('lamp', 4, 'Лампа направляет внимание на рабочую задачу.')] },
  { id: 'writing', label: 'Записи и выражение мыслей', stems: ['запис', 'замет', 'текст', 'письм', 'писать', 'авторств', 'авторск', 'договор', 'подпис', 'планир', 'writing', 'notes'], links: [link('pen', 6, 'Ручка обозначает запись и выражение мыслей.'), link('book', 2, 'Книга поддерживает тему текста и письменных материалов.')] },
  { id: 'opportunity', label: 'Доступ и возможности', stems: ['возможност', 'доступ', 'открыт', 'opportunit', 'access'], phrases: ['новые горизонты'], links: [link('phone', 5, 'Телефон обозначает доступ к сервисам и новым возможностям.'), link('book', 4, 'Книга поддерживает открытие новых знаний.'), link('lamp', 2, 'Лампа поддерживает идею нового направления.')] },
  { id: 'experience', label: 'Опыт и практика', stems: ['опыт', 'практик', 'мудрост'], links: [link('book', 7, 'Книга передаёт накопленный опыт и практические знания.')] },
  { id: 'instruction', label: 'Инструкция и руководство', stems: ['инструкц', 'руководств', 'пособи', 'справоч'], links: [link('book', 7, 'Книга обозначает инструкцию, руководство и проверенный способ действий.')] },
  { id: 'research', label: 'Исследование и изучение', stems: ['исслед', 'изуч', 'анализ', 'эксперимент'], links: [link('book', 7, 'Книга обозначает исследование и изучение материалов.'), link('lamp', 2, 'Лампа поддерживает поиск открытия и понимания.')] },
  { id: 'memory', label: 'Память и воспоминания', stems: ['память', 'памяти', 'памятью', 'воспомин', 'мемуар', 'наследи'], unless: ['телефон', 'смартфон', 'компьютер', 'устройств', 'оперативн', 'флеш', 'гигабайт', 'мегабайт', 'диск'], links: [link('book', 7, 'Книга хранит воспоминания, историю и память поколений.')] },
  { id: 'value', label: 'Ценность и вознаграждение', stems: ['ценност', 'ценный', 'ценная', 'ценное', 'ценного', 'ценном', 'ценных', 'ценным', 'цену', 'цена', 'цены', 'ценой', 'цене', 'стоимост', 'доход', 'заработ', 'вознагражд', 'прибыл', 'обмен'], exact: ['вклад', 'вклада', 'вкладу', 'вкладом', 'вкладе', 'вклады', 'вкладов'], links: [link('coin', 7, 'Монета передаёт отдельную ценность, доход, обмен или вознаграждение.')] },
  { id: 'independence', label: 'Финансовая самостоятельность', stems: [], phrases: ['финансовая самостоятельность', 'финансовой самостоятельности', 'финансовая независимость', 'финансовой независимости', 'собственный бюджет'], links: [link('wallet', 8, 'Кошелёк передаёт управление собственными деньгами и финансовую самостоятельность.')] },
  { id: 'listening', label: 'Умение слушать', stems: ['слыш', 'услыш', 'выслуш', 'прислуш'], phrases: ['слушать клиента', 'слушать собеседника'], links: [link('headphones', 7, 'Наушники передают умение услышать другого и внимательно слушать.'), link('phone', 2, 'Телефон поддерживает общение с собеседником.')] },
];

const MENTIONS: Record<string, string[]> = {
  book: ['книг', 'book'], phone: ['телефон', 'смартфон', 'phone'], pen: ['ручк', 'pen'], folder: ['папк', 'folder'],
  wallet: ['кошел', 'wallet'], coin: ['монет', 'coin'], headphones: ['наушник', 'headphone'], puzzle: ['пазл', 'puzzle'], lamp: ['ламп', 'lamp'], 'flower-vase': ['ваз', 'букет', 'vase', 'flower'],
};
const FLOWERS = new Set(['цветы', 'цветов', 'цветами', 'цветок', 'цветка']);
const STOP = new Set(['для', 'как', 'это', 'про', 'при', 'наш', 'ваш', 'свой', 'мои', 'моих', 'его', 'она', 'они', 'оно', 'все', 'чтобы', 'хочу', 'нарисуй', 'покажи', 'добавь', 'иллюстрация']);
const MISSING = new Map([
  ['ракета', 'ракета'], ['ракету', 'ракета'], ['ракеты', 'ракета'], ['самолет', 'самолёт'], ['самолета', 'самолёт'],
  ['автомобиль', 'автомобиль'], ['машина', 'машина'], ['робот', 'робот'], ['робота', 'робот'], ['часы', 'часы'], ['дерево', 'дерево'], ['человек', 'человек'],
]);
const normalize = (text: string) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
function mentions(word: string): string[] {
  const found = Object.entries(MENTIONS).filter(([, stems]) => stems.some(stem => /^[a-z]+$/.test(stem) ? word === stem || word === stem + 's' : word.startsWith(stem))).map(([id]) => id);
  if (FLOWERS.has(word)) found.push('flower-vase');
  return found;
}
function evidence(concept: Concept, originalWords: string[], phrases: PhraseMatches = matchMeaningPhrases(originalWords)) {
  const words = originalWords.map((word, index) => phrases.claimed.has(index) ? "|" : word);
  if (concept.unless?.some(stem => originalWords.some(word => word.startsWith(stem)))) return [];
  const found = [...(phrases.evidence.get(concept.id) ?? []), ...words.filter(word => concept.exact?.includes(word) || concept.stems.some(stem => word.startsWith(stem)))];
  const text = ' ' + words.join(' ') + ' ';
  for (const phrase of concept.phrases ?? []) if (text.includes(' ' + phrase + ' ')) found.push(...phrase.split(' '));
  return [...new Set(found)];
}

function splitNegation(prompt: string) {
  const tokens = normalize(prompt).match(/[\p{L}\p{N}]+|[,;.!?:]/gu) ?? [];
  const positive: string[] = [], negative: string[] = [];
  let negated = false;
  for (let index = 0; index < tokens.length; index++) {
    const word = tokens[index]!;
    if (/^[,;.!?:]$/.test(word) || ['но', 'зато', 'а'].includes(word)) { negated = false; positive.push('|'); negative.push('|'); continue; }
    if (word === 'без') { negated = true; continue; }
    if (word === 'не' && ['добавляй', 'используй', 'добавлять', 'использовать', 'нужен', 'нужна', 'нужны'].includes(tokens[index + 1] ?? '')) { negated = true; index++; continue; }
    (negated ? negative : positive).push(word);
  }
  return { positive, negative };
}

const semanticWords = (text: string) => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
// Conservative suffix folding for user-authored labels, not a full morphological parser.
const semanticStem = (word: string) => word.length > 4 ? word.replace(/(?:иями|ами|ями|ого|ему|ому|ыми|ими|ией|ия|ие|ии|ый|ий|ой|ая|яя|ое|ее|ые|их|ых|ов|ев|ам|ям|ах|ях|ом|ем|у|ю|а|я|ы|и|е|о)$/u, '') : word;
function labelEvidence(label: string, words: string[]): string[] {
  const target = semanticWords(label);
  if (!target.length) return [];
  for (let index = 0; index <= words.length - target.length; index++) {
    if (target.every((word, offset) => semanticStem(word) === semanticStem(words[index + offset]!))) return words.slice(index, index + target.length);
  }
  return [];
}

export function selectObjectsByTheme(catalog: Catalog, text: string, options: { includeBackgroundObjects?: boolean } = {}): MeaningResult {
  if (typeof text !== 'string' || text.trim().length < 2 || text.trim().length > 300) throw new Error('Введите заголовок длиной от 2 до 300 символов');
  const prompt = text.trim();
  const { positive, negative } = splitNegation(prompt);
  const positivePhrases = matchMeaningPhrases(positive), negativePhrases = matchMeaningPhrases(negative);
  const available = new Set(catalog.objects.map(object => object.id));
  const excluded = new Set(negative.flatMap(mentions));
  const customs = catalog.objects.filter(object => object.custom);
  const labels = (object: typeof customs[number]) => [object.name, ...object.tags, ...(object.meanings ?? [])];
  const customLabels = new Map(customs.map(object => [object.id, labels(object).map(label => { const words = semanticWords(label); return { words, phrases: matchMeaningPhrases(words) }; })]));
  const conceptSource = CONCEPTS.map(concept => ({ ...concept, links: [...concept.links, ...customs.filter(object => customLabels.get(object.id)!.some(label => evidence(concept, label.words, label.phrases).length)).map(object => link(object.id, 8, `Свой SVG «${object.name}» связан с темой «${concept.label}» через заданные теги и смыслы.`))] }));
  for (const object of customs) if (labels(object).some(label => labelEvidence(label, negative).length)) excluded.add(object.id);
  for (const concept of conceptSource) if (evidence(concept, negative, negativePhrases).length) {
    for (const id of concept.negatedObjects ?? []) excluded.add(id);
    for (const connection of concept.links) if (connection.weight >= 5) excluded.add(connection.objectId);
  }
  const concepts = conceptSource.map(concept => ({ ...concept, evidence: evidence(concept, positive, positivePhrases) })).filter(concept => concept.evidence.length);
  const direct = new Set(positive.flatMap(mentions).filter(id => available.has(id) && !excluded.has(id)));
  const customMatches = customs.filter(object => !excluded.has(object.id)).map(object => ({ object, evidence: [...new Set(labels(object).flatMap(label => labelEvidence(label, positive)))] })).filter(match => match.evidence.length);
  for (const match of customMatches) direct.add(match.object.id);
  const ranks = new Map<string, { score: number; reasons: string[]; concepts: string[] }>();
  for (const objectId of direct) ranks.set(objectId, { score: 9, reasons: ['Предмет прямо указан в заголовке.'], concepts: [] });
  for (const { object, evidence: found } of customMatches) ranks.set(object.id, { score: 10, reasons: [`Свой SVG «${object.name}»: совпадение с названием, тегами или смыслами — ${found.join(', ')}.`], concepts: [] });
  for (const concept of concepts) for (const connection of concept.links) {
    if (!available.has(connection.objectId) || excluded.has(connection.objectId)) continue;
    const rank = ranks.get(connection.objectId) ?? { score: 0, reasons: [], concepts: [] };
    const phraseBoost = positivePhrases.evidence.has(concept.id) && connection.weight === Math.max(...concept.links.map(item => item.weight)) ? 2 : 0;
    rank.score += connection.weight + phraseBoost; rank.reasons.push(connection.reason); rank.concepts.push(concept.id);
    ranks.set(connection.objectId, rank);
  }
  const ranked = [...ranks.entries()].sort((a, b) => Number(direct.has(b[0])) - Number(direct.has(a[0])) || b[1].score - a[1].score || a[0].localeCompare(b[0], 'en'));
  const limitations: string[] = [];
  const customAccounted = new Set(customMatches.flatMap(match => match.evidence));
  const missing = [...new Set(positive.flatMap(word => MISSING.has(word) && !customAccounted.has(word) ? [MISSING.get(word)!] : []))];
  if (missing.length) limitations.push('В библиотеке нет отдельных предметов: ' + missing.join(', ') + '. Новые объекты не создаются.');
  const base: MeaningResult = { provider: 'local', prompt, status: 'unmatched', summary: '', concepts: concepts.map(concept => ({ id: concept.id, label: concept.label, evidence: concept.evidence })), items: [], excludedObjectIds: [...excluded].filter(id => available.has(id)), limitations };
  if (direct.size > 6) return { ...base, summary: 'В заголовке перечислено больше шести предметов. Сократите список.' };
  if (!ranked.length) return { ...base, summary: 'Не нашёл надёжной связи с предметами библиотеки. Уточните тему: обучение, финансы, идеи, работа, музыка или забота.' };
  const strongest = ranked[0]![1].score;
  // Cover distinct meanings before filling by aggregate score: a third idea must
  // not disappear just because the previous picker always stopped at two items.
  const anchors = concepts.map(concept => concept.links.filter(connection => available.has(connection.objectId) && !excluded.has(connection.objectId)).sort((a, b) => b.weight - a.weight)[0]?.objectId);
  const selected = new Set(direct);
  for (const [id] of ranked) if (anchors.includes(id) && selected.size < Math.max(3, direct.size)) selected.add(id);
  for (const [id, rank] of ranked) if (selected.size < 2 && rank.score >= strongest * 0.45) selected.add(id);
  const main = ranked.filter(([id]) => selected.has(id));
  const meaningsCovered = anchors.every(id => id !== undefined && selected.has(id));
  const noBackground = /без\s+фонов[\p{L}]*/u.test(normalize(prompt));
  const support = options.includeBackgroundObjects && !noBackground && main.length < 6 ? ranked.filter(([id]) => !main.some(([mainId]) => mainId === id)).slice(0, 1) : [];
  base.items = [...main.map(([id, rank]): MeaningItem => ({ objectId: id, role: 'main', reason: rank.reasons.slice(0, 2).join(' '), conceptIds: rank.concepts })), ...support.map(([id, rank]): MeaningItem => ({ objectId: id, role: 'secondary', reason: rank.reasons.slice(0, 2).join(' '), conceptIds: rank.concepts }))];
  const accounted = new Set([...customAccounted, ...concepts.flatMap(concept => concept.evidence), ...positive.filter(word => mentions(word).some(id => direct.has(id)))]);
  const significant = positive.filter(word => word.length >= 3 && !STOP.has(word));
  const coverage = significant.length ? significant.filter(word => accounted.has(word)).length / significant.length : 0;
  base.status = coverage >= 0.5 && !missing.length && meaningsCovered ? 'matched' : 'partial';
  base.summary = concepts.length
    ? 'Связал тему с понятиями: ' + concepts.map(concept => concept.label.toLocaleLowerCase('ru')).join(', ') + '.'
    : customMatches.length ? 'Сопоставил фразу с названиями, тегами и смыслами ваших SVG.'
    : 'Нашёл в заголовке названия предметов и использовал их как основу композиции.';
  if (base.status === 'partial') base.limitations.push('Распознана только часть формулировки. Проверьте выбранные предметы или уточните тему.');
  if (!meaningsCovered) base.limitations.push('Не все найденные темы представлены главными предметами. Сузьте формулировку или уточните состав вручную.');
  if (noBackground && options.includeBackgroundObjects) base.limitations.push('Фоновые предметы исключены по формулировке заголовка.');
  validateMeaningResult(base, catalog);
  return base;
}

export function validateMeaningResult(value: unknown, catalog: Catalog): asserts value is MeaningResult {
  if (!value || typeof value !== 'object') throw new Error('Неверный результат смыслового подбора');
  const result = value as MeaningResult;
  if (result.provider !== 'local' || !['matched', 'partial', 'unmatched'].includes(result.status)) throw new Error('Неизвестный способ смыслового подбора');
  if (typeof result.prompt !== 'string' || result.prompt.trim().length < 2 || result.prompt.length > 300 || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 2000) throw new Error('Неверное описание смыслового подбора');
  if (!Array.isArray(result.items) || result.items.length > 6 || !Array.isArray(result.concepts) || result.concepts.length > 30 || !Array.isArray(result.limitations) || result.limitations.length > 10 || !Array.isArray(result.excludedObjectIds)) throw new Error('Неверный состав смыслового подбора');
  const known = new Set(catalog.objects.map(object => object.id)), ids = new Set<string>();
  for (const item of result.items) {
    if (!item || !known.has(item.objectId) || ids.has(item.objectId) || !['main', 'secondary'].includes(item.role) || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 1000 || !Array.isArray(item.conceptIds) || item.conceptIds.some(id => typeof id !== 'string' || id.length > 60)) throw new Error('Подбор содержит неизвестный или неверно описанный предмет');
    ids.add(item.objectId);
  }
  for (const id of result.excludedObjectIds) if (typeof id !== 'string' || !known.has(id) || ids.has(id)) throw new Error('Исключённый предмет попал в подбор');
  for (const note of result.limitations) if (typeof note !== 'string' || note.length > 2000) throw new Error('Неверное ограничение подбора');
  for (const concept of result.concepts) if (!concept || typeof concept.id !== 'string' || concept.id.length > 60 || typeof concept.label !== 'string' || concept.label.length > 120 || !Array.isArray(concept.evidence) || concept.evidence.length > 100 || concept.evidence.some(word => typeof word !== 'string' || word.length > 300)) throw new Error('Неверное описание смысловой связи');
  if (result.status === 'unmatched' ? result.items.length !== 0 : !result.items.some(item => item.role === 'main')) throw new Error('Подбор не содержит главного предмета');
}

export function objectsFromMeaning(catalog: Catalog, result: MeaningResult, roles: Record<string, ObjectRole> = {}): SceneObject[] {
  validateMeaningResult(result, catalog);
  if (result.status === 'unmatched') throw new Error(result.summary);
  return result.items.map(item => ({ instanceId: `theme-${item.objectId}`, objectId: item.objectId, role: roles[`theme-${item.objectId}`] ?? item.role, x: 0.5, y: 0.5, rotation: 0 }));
}

export const THEME_EXAMPLES = ['Обучение онлайн', 'Безопасные покупки', 'Финансовая подушка', 'Собрать решение по частям', 'Полёт мысли', 'Время для себя'];
