// Shared coach copy — safe to import on the client (NO server-only imports).
// Used both by the chat UI (instant welcome + loading animation) and the
// coach API (to seed the system prompt with on-brand nickname options).

export type CoachGender = 'male' | 'female' | 'other' | null | undefined;

/** Fun nicknames the coach uses, keyed by gender. */
export const nicknamesByGender: Record<'male' | 'female' | 'neutral', string[]> = {
	male: ['bro', 'king', 'legend', 'beast', 'machine', 'champ', 'my dude', 'you magnificent stallion'],
	female: ['sis', 'queen', 'legend', 'beast', 'machine', 'champ', 'girl', 'you magnificent gazelle'],
	neutral: [
		'legend',
		'champ',
		'beast',
		'machine',
		'superstar',
		'you beautiful donut',
		'you glorious creature',
		'rockstar'
	]
};

function nickPool(gender: CoachGender): string[] {
	if (gender === 'male') return nicknamesByGender.male;
	if (gender === 'female') return nicknamesByGender.female;
	return nicknamesByGender.neutral;
}

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

/** Pick a nickname appropriate for the user's gender. */
export function pickNickname(gender: CoachGender): string {
	return pick(nickPool(gender));
}

/** Gym-bro / gym-sis welcome messages. {nick} = nickname, {name} = first name. */
export const welcomeTemplates: string[] = [
	"YO {nick}! 💪 Your race coach just chugged a pre-workout and I'm READY. What are we chasing today?",
	"Ayyy {nick}! 🔥 Rise and grind. Tell me the distance, tell me the dream — I'll find the race.",
	"Well well well, look who showed up. Good to see you, {nick}. 😎 What's the mission?",
	"LET'S GOOO {nick}! 🏃‍♂️💨 I live to find you start lines. Drop a distance and a date and watch me work.",
	"Sup {nick}! 🦾 I've been doing squats while waiting for you. Now — what kind of race are we hunting?",
	"{name}!! My favourite athlete. 🏅 Tell me what you want to run and I'll move mountains (and maybe add some).",
	"Big energy today, {nick}. ⚡ Throw me a goal — a chill 5k, a savage marathon, anything — I gotchu.",
	"Knock knock. It's your coach. 🥇 No rest days for me, {nick}. What race are we locking in?",
	"Oh it's ON, {nick}. 🔥 I smell PBs in the air. Give me a distance and a timeframe, let's cook.",
	"Hey {nick}, you beautiful machine. 🛠️ I find races, I add races, I hype you up. What do you need?",
	"Coach reporting for duty, {nick}! 🫡 Hit me with a distance, a city, a month — I'll do the rest.",
	"There they are! 🌟 Alright {nick}, lace up mentally — what kind of race are we dreaming about today?"
];

/** Cool 'thinking' texts shown while the coach works. */
export const loadingTexts: string[] = [
	'Bribing the Olympics committee…',
	'Turning over every rock…',
	"Lacing up the server's shoes…",
	'Sniffing out hidden start lines…',
	'Negotiating with the weather gods…',
	'Counting cones along the route…',
	'Carbo-loading the database…',
	'Stretching the algorithms…',
	'Interrogating the finish line…',
	'Chasing down rogue race directors…',
	'Polishing the medals just in case…',
	'Reading the fine print so you don’t have to…',
	'Consulting the ancient marathon scrolls…',
	'Doing burpees for motivation…',
	'Sweet-talking the timing chips…',
	'Scanning the horizon for hidden gems…'
];

/** Returns an instant, on-brand welcome message for the user. */
export function pickWelcome(gender: CoachGender, name?: string | null): string {
	const nick = pickNickname(gender);
	const firstName = (name ?? '').trim().split(/\s+/)[0] || nick;
	return pick(welcomeTemplates).replaceAll('{nick}', nick).replaceAll('{name}', firstName);
}

/** Returns a random loading text. */
export function pickLoadingText(): string {
	return pick(loadingTexts);
}
