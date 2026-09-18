"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const supabase_js_1 = require("@supabase/supabase-js");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.get('/api/v1/teams', async (req, res) => {
    const { userId } = req.query;
    if (!userId)
        return res.status(400).json({ error: 'userId is required' });
    const { data, error } = await supabase
        .from('team_members')
        .select('team_id, role, teams(id, name, plan)')
        .eq('user_id', userId);
    if (error)
        return res.status(500).json({ error: error.message });
    res.json({ success: true, teams: data.map((d) => ({ ...d.teams, role: d.role })) });
});
app.post('/api/v1/teams/:teamId/invite', async (req, res) => {
    const { teamId } = req.params;
    const { email, role, inviterId } = req.body;
    const { data: inviter } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', inviterId).single();
    if (!inviter || !['owner', 'admin'].includes(inviter.role)) {
        return res.status(403).json({ error: 'Only admins can invite' });
    }
    const { data: { users }, error: fetchErr } = await supabase.auth.admin.listUsers();
    const targetUser = users.find((u) => u.email === email);
    if (!targetUser)
        return res.status(404).json({ error: 'User not found' });
    const { error } = await supabase.from('team_members').insert({
        team_id: teamId,
        user_id: targetUser.id,
        role
    });
    if (error)
        return res.status(500).json({ error: error.message });
    res.json({ success: true, message: 'Invited successfully' });
});
app.post('/api/v1/teams/:teamId/billing', async (req, res) => {
    const { teamId } = req.params;
    const { plan, requesterId } = req.body;
    const { data: requester } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', requesterId).single();
    if (!requester || requester.role !== 'owner')
        return res.status(403).json({ error: 'Only owners can manage billing' });
    const { error } = await supabase.from('teams').update({ plan }).eq('id', teamId);
    if (error)
        return res.status(500).json({ error: error.message });
    res.json({ success: true });
});
const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
    console.log(`Team Service running on port ${PORT}`);
});
