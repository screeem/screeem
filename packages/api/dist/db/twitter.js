export async function getTwitterAccountByOrg(client, organizationId) {
    const result = await client.query(`SELECT * FROM twitter_accounts WHERE organization_id = $1`, [organizationId]);
    return result.rows[0] || null;
}
export async function getTwitterAccountById(client, id) {
    const result = await client.query(`SELECT * FROM twitter_accounts WHERE id = $1`, [id]);
    return result.rows[0] || null;
}
export async function createTwitterAccount(client, params) {
    const result = await client.query(`INSERT INTO twitter_accounts (
      organization_id,
      account_name,
      account_id,
      access_token,
      refresh_token,
      expires_at,
      connected_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (organization_id)
    DO UPDATE SET
      account_name = EXCLUDED.account_name,
      account_id = EXCLUDED.account_id,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      connected_by = EXCLUDED.connected_by,
      updated_at = NOW()
    RETURNING *`, [
        params.organizationId,
        params.accountName,
        params.accountId,
        params.accessToken,
        params.refreshToken || null,
        params.expiresAt || null,
        params.connectedBy,
    ]);
    return result.rows[0];
}
export async function updateTwitterTokens(client, organizationId, accessToken, refreshToken, expiresAt) {
    await client.query(`UPDATE twitter_accounts
     SET access_token = $1,
         refresh_token = $2,
         expires_at = $3,
         updated_at = NOW()
     WHERE organization_id = $4`, [accessToken, refreshToken || null, expiresAt || null, organizationId]);
}
export async function deleteTwitterAccount(client, organizationId) {
    await client.query(`DELETE FROM twitter_accounts WHERE organization_id = $1`, [organizationId]);
}
