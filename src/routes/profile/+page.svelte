<script lang="ts">
	let { data } = $props();

	const statusGroups = ['attending', 'interested', 'following', 'seen', 'skip'] as const;
	const statusLabels: Record<string, string> = {
		attending: '🏁 Attending',
		interested: '❤️ Interested',
		following: '🔔 Following',
		seen: '✓ Seen',
		skip: '✕ Skipped'
	};
	const catLabel: Record<string, string> = {
		local: 'Local',
		norway: 'Norway',
		international: 'International'
	};
	const catCls: Record<string, string> = {
		local: 'cat-local',
		norway: 'cat-norway',
		international: 'cat-intl'
	};
	const medalLabel: Record<string, string> = {
		confirmed: '🏅 Medal confirmed',
		likely: '🥈 Medal likely',
		unclear: 'Medal unclear'
	};
	const medalCls: Record<string, string> = {
		confirmed: 'medal-confirmed',
		likely: 'medal-likely',
		unclear: 'medal-unclear'
	};

	function grouped(status: string) {
		return data.triaged.filter((t) => t.status === status);
	}

	function formatDate(d: string | null) {
		if (!d) return null;
		return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<svelte:head><title>My Profile — PaceFinder</title></svelte:head>

<div class="profile-wrap">
	<div class="profile-header">
		<h1 class="profile-title">My Races</h1>
		<span class="profile-count">{data.triaged.length} triaged</span>
	</div>

	{#if data.triaged.length === 0}
		<div class="empty-state">
			<p class="empty-text">You haven't triaged any races yet.</p>
			<a href="/races" class="empty-link">Browse races →</a>
		</div>
	{:else}
		{#each statusGroups as status}
			{#if grouped(status).length > 0}
				<div class="status-group">
					<h2 class="status-label">{statusLabels[status]}</h2>
					<div class="race-list">
						{#each grouped(status) as item}
							<a href="/races/{item.race.id}" class="race-card">
								<div class="race-main">
									<p class="race-name">{item.race.name}</p>
									<div class="race-meta">
										<span class="badge {catCls[item.race.category] ?? 'cat-local'}">
											{catLabel[item.race.category] ?? item.race.category}
										</span>
										<span class="badge {medalCls[item.race.medalStatus] ?? 'medal-unclear'}">
											{medalLabel[item.race.medalStatus] ?? 'Medal unclear'}
										</span>
										{#if item.race.raceDate}
											<span class="race-date">{formatDate(item.race.raceDate)}</span>
										{/if}
									</div>
									{#if item.notes}
										<p class="race-notes">{item.notes}</p>
									{/if}
								</div>
								<span class="race-updated">{formatDate(item.updatedAt)}</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	{/if}
</div>

<style>
	.profile-wrap {
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.profile-header {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}
	.profile-title {
		font-size: 1.5rem;
		font-weight: 800;
		color: #f1f5f9;
		margin: 0;
	}
	.profile-count {
		font-size: 0.8rem;
		color: rgba(255,255,255,0.4);
		font-weight: 500;
	}
	.empty-state {
		background: rgba(255,255,255,0.04);
		border: 1.5px dashed rgba(255,255,255,0.12);
		border-radius: 16px;
		padding: 48px 24px;
		text-align: center;
	}
	.empty-text {
		color: rgba(255,255,255,0.45);
		margin: 0 0 16px;
	}
	.empty-link {
		color: #a3e635;
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
	}
	.empty-link:hover { text-decoration: underline; }

	.status-group {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.status-label {
		font-size: 0.85rem;
		font-weight: 700;
		color: #a3e635;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0;
	}
	.race-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.race-card {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 14px;
		padding: 14px 16px;
		text-decoration: none;
		transition: background 0.15s, border-color 0.15s;
	}
	.race-card:hover {
		background: rgba(255,255,255,0.08);
		border-color: rgba(163,230,53,0.3);
	}
	.race-main {
		min-width: 0;
		flex: 1;
	}
	.race-name {
		font-weight: 600;
		font-size: 0.95rem;
		color: #f1f5f9;
		margin: 0 0 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.race-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		border-radius: 99px;
		border: 1px solid;
		padding: 1px 8px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.cat-local    { background: rgba(96,165,250,0.15); color: #93c5fd; border-color: rgba(96,165,250,0.3); }
	.cat-norway   { background: rgba(167,139,250,0.15); color: #c4b5fd; border-color: rgba(167,139,250,0.3); }
	.cat-intl     { background: rgba(251,146,60,0.15); color: #fdba74; border-color: rgba(251,146,60,0.3); }
	.medal-confirmed { background: rgba(163,230,53,0.15); color: #a3e635; border-color: rgba(163,230,53,0.3); }
	.medal-likely    { background: rgba(52,211,153,0.15); color: #6ee7b7; border-color: rgba(52,211,153,0.3); }
	.medal-unclear   { background: rgba(251,191,36,0.12); color: #fbbf24; border-color: rgba(251,191,36,0.25); }
	.race-date {
		font-size: 0.75rem;
		color: rgba(255,255,255,0.4);
	}
	.race-notes {
		margin: 6px 0 0;
		font-size: 0.75rem;
		color: rgba(255,255,255,0.4);
		font-style: italic;
	}
	.race-updated {
		font-size: 0.7rem;
		color: rgba(255,255,255,0.3);
		white-space: nowrap;
		flex-shrink: 0;
		padding-top: 2px;
	}
</style>
