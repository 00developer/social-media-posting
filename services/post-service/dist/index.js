"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const supabase_js_1 = require("@supabase/supabase-js");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
app.post('/api/v1/posts', async (req, res) => {
    const { userId, teamId, content, mediaUrl } = req.body;
    if (!userId || !teamId || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // 1. Enforce RBAC
    const { data: member } = await supabase.from('team_members')
        .select('role, teams(plan)')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .single();
    if (!member || member.role === 'viewer') {
        return res.status(403).json({ error: 'Unauthorized: Viewers cannot create posts' });
    }
    // 2. Enforce Billing limits
    const plan = member.teams.plan;
    if (plan === 'free') {
        const { count } = await supabase.from('posts').select('*', { count: 'exact', head: true }).eq('team_id', teamId);
        if (count !== null && count >= 5) {
            return res.status(402).json({ error: 'Billing limit reached: Free plan allows max 5 posts.' });
        }
    }
    const { data, error } = await supabase.from('posts').insert({
        team_id: teamId,
        user_id: userId,
        content,
        media_url: mediaUrl,
        status: 'draft'
    }).select().single();
    if (error)
        return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
});
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Post Service listening on port ${PORT}`));
