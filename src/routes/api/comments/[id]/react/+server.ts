import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { comments, commentReactions } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const ALLOWED = ['fire', 'muscle', 'tada', 'heart', 'sweat', 'goat'];

/** Toggle the current user's reaction of a given emoji on a comment. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Sign in to react');

	const { emoji } = (await request.json().catch(() => ({}))) as { emoji?: string };
	if (!emoji || !ALLOWED.includes(emoji)) error(400, 'Invalid reaction');

	// Make sure the comment exists (and isn't deleted)
	const comment = await db.query.comments.findFirst({ where: eq(comments.id, params.id) });
	if (!comment || comment.deletedAt) error(404, 'Comment not found');

	const existing = await db.query.commentReactions.findFirst({
		where: and(
			eq(commentReactions.commentId, params.id),
			eq(commentReactions.userId, locals.user.id),
			eq(commentReactions.emoji, emoji)
		)
	});

	let reacted: boolean;
	if (existing) {
		await db.delete(commentReactions).where(eq(commentReactions.id, existing.id));
		reacted = false;
	} else {
		await db
			.insert(commentReactions)
			.values({ commentId: params.id, userId: locals.user.id, emoji })
			.onConflictDoNothing();
		reacted = true;
	}

	const rows = await db
		.select({ emoji: commentReactions.emoji })
		.from(commentReactions)
		.where(eq(commentReactions.commentId, params.id));

	const counts: Record<string, number> = {};
	for (const r of rows) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;

	return json({ reacted, emoji, counts });
};
