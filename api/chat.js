// /api/chat.js
// Серверная функция Vercel — безопасно обращается к OpenRouter,
// пряча API-ключ от пользователей сайта.

export default async function handler(req, res) {
    // Разрешаем запросы только методом POST
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        res.status(500).json({ error: 'OPENROUTER_API_KEY не настроен в Vercel' });
        return;
    }

    try {
        const { prompt, max_tokens } = req.body;

        if (!prompt) {
            res.status(400).json({ error: 'Не передан prompt' });
            return;
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                // Эти два заголовка требует OpenRouter для бесплатных моделей
                'HTTP-Referer': 'https://opisetz.vercel.app',
                'X-Title': 'O Pisets'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3-next-80b-a3b-instruct:free',
                max_tokens: max_tokens || 2000,
                messages: [
                    { role: 'user', content: prompt }
                ]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('OpenRouter error:', data);
            res.status(response.status).json({ error: data.error?.message || 'Ошибка OpenRouter' });
            return;
        }

        // Приводим ответ к простому формату { text: "..." }
        const text = data.choices?.[0]?.message?.content || '';
        res.status(200).json({ text });

    } catch (err) {
        console.error('Proxy error:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}
