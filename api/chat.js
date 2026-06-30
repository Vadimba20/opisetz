// /api/chat.js
// Серверная функция Vercel — безопасно обращается к OpenRouter,
// пряча API-ключ от пользователей сайта.
//
// Используем openrouter/free — специальный роутер OpenRouter,
// который сам выбирает рабочую бесплатную модель и переключается
// на другую, если выбранная перегружена. Это надёжнее, чем
// вручную перечислять конкретные модели.

const FREE_ROUTER = 'openrouter/free';
// Запасной вариант на случай, если роутер откажет целиком —
// конкретная стабильная модель.
const BACKUP_MODEL = 'qwen/qwen3-next-80b-a3b-instruct:free';

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

        // Попытки 1-3: используем умный роутер бесплатных моделей.
        // Он сам выбирает рабочую модель из доступных.
        for (let attempt = 1; attempt <= 3; attempt++) {
            const r = await callOpenRouter(apiKey, FREE_ROUTER, prompt, max_tokens);

            if (r.ok) {
                result = r;
                break;
            }

            lastError = r.data;
            console.error(`Попытка ${attempt} (роутер) не удалась:`, r.data);

            const isRateLimited = r.status === 429;
            if (isRateLimited && attempt < 3) {
                const retryAfter = r.data?.error?.metadata?.retry_after_seconds || 3;
                await sleep(Math.min(retryAfter, 6) * 1000);
                continue;
            }
            break;
        }

        // Финальная попытка: конкретная резервная модель напрямую
        if (!result) {
            console.log('Роутер не сработал, пробуем напрямую:', BACKUP_MODEL);
            const r = await callOpenRouter(apiKey, BACKUP_MODEL, prompt, max_tokens);
            if (r.ok) {
                result = r;
            } else {
                lastError = r.data;
                console.error('Резервная модель тоже не сработала:', r.data);
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
