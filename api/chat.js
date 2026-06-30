// /api/chat.js
// Серверная функция Vercel — безопасно обращается к OpenRouter,
// пряча API-ключ от пользователей сайта.
// Имеет автоматический повтор при перегрузке (429) и запасную модель.

const PRIMARY_MODEL  = 'qwen/qwen3-next-80b-a3b-instruct:free';
const FALLBACK_MODEL = 'google/gemini-2.0-flash-exp:free';

async function callOpenRouter(apiKey, model, prompt, max_tokens) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://opisetz.vercel.app',
            'X-Title': 'O Pisets'
        },
        body: JSON.stringify({
            model: model,
            max_tokens: max_tokens || 2000,
            messages: [
                { role: 'user', content: prompt }
            ]
        })
    });

    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

        let result = null;
        let lastError = null;

        // Попытка 1-2: основная модель с повтором при 429
        for (let attempt = 1; attempt <= 2; attempt++) {
            const r = await callOpenRouter(apiKey, PRIMARY_MODEL, prompt, max_tokens);

            if (r.ok) {
                result = r;
                break;
            }

            const isRateLimited = r.status === 429;
            lastError = r.data;
            console.error(`Попытка ${attempt} (основная модель) не удалась:`, r.data);

            if (isRateLimited && attempt < 2) {
                // Ждём перед повтором (модель сообщает retry_after_seconds, но ограничим разумным временем)
                const retryAfter = r.data?.error?.metadata?.retry_after_seconds || 3;
                await sleep(Math.min(retryAfter, 8) * 1000);
                continue;
            }
            // Если не rate-limit или попытки исчерпаны — выходим из цикла
            break;
        }

        // Попытка 3: запасная модель, если основная так и не ответила
        if (!result) {
            console.log('Переключаемся на запасную модель:', FALLBACK_MODEL);
            const r = await callOpenRouter(apiKey, FALLBACK_MODEL, prompt, max_tokens);
            if (r.ok) {
                result = r;
            } else {
                lastError = r.data;
                console.error('Запасная модель тоже не сработала:', r.data);
            }
        }

        if (!result) {
            const message = lastError?.error?.message || 'ИИ временно перегружен. Попробуйте через минуту.';
            res.status(503).json({ error: message });
            return;
        }

        const text = result.data.choices?.[0]?.message?.content || '';
        res.status(200).json({ text });

    } catch (err) {
        console.error('Proxy error:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}
