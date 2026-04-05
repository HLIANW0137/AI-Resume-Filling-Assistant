// ==UserScript==
// @name         AI 智能简历助手 (V2.4 悬浮小圆圈折叠版)
// @namespace    http://tampermonkey.net/
// @version      2.4.0
// @description  优化 UI，支持最小化为悬浮小圆圈，避免遮挡视野，支持状态记忆。
// @author       Gemini
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let config = GM_getValue('ai_resume_config', {
        apiUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        apiKey: '',
        model: 'meta/llama-3.1-8b-instruct'
    });
    let resumeData = GM_getValue('ai_resume_data', '');
    // 增加 UI 状态记忆，默认最小化
    let uiState = GM_getValue('ai_resume_ui_state', { minimized: true });

    // ==========================================
    // 1. 底层穿透点击器
    // ==========================================
    function simulateUltimateClick(element) {
        if (!element) return false;
        try {
            const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
            events.forEach(type => {
                element.dispatchEvent(new MouseEvent(type, {
                    bubbles: true, cancelable: true, view: window, buttons: 1, composed: true
                }));
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    // ==========================================
    // 2. 增强型注入
    // ==========================================
    async function ultimateFill(element, value) {
        if (!element || !value || value === "null" || value === "") return;

        const y = element.getBoundingClientRect().top + window.scrollY - 150;
        window.scrollTo({ top: y, behavior: 'smooth' });
        element.focus();

        if (element.tagName === 'SELECT') {
            const options = Array.from(element.options);
            const target = options.find(o => o.text.trim() === value || o.text.includes(value));
            if (target) {
                element.value = target.value;
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }
            element.style.backgroundColor = '#e6ffed';
            return;
        }

        simulateUltimateClick(element);
        await new Promise(r => setTimeout(r, 300));

        let optionClicked = false;
        if (value.length > 0 && value.length < 25) {
            const xpathExact = `//text()[normalize-space(.)='${value}']/parent::*`;
            const iteratorExact = document.evaluate(xpathExact, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            let bestMatch = null;
            for (let i = 0; i < iteratorExact.snapshotLength; i++) {
                const node = iteratorExact.snapshotItem(i);
                if (node !== element && !['SCRIPT', 'STYLE', 'TITLE'].includes(node.tagName)) {
                    const rect = node.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) { bestMatch = node; break; }
                }
            }
            if (bestMatch) {
                simulateUltimateClick(bestMatch);
                optionClicked = true;
                await new Promise(r => setTimeout(r, 100));
            }
        }

        if (!optionClicked) {
            const wasReadonly = element.hasAttribute('readonly');
            const wasDisabled = element.hasAttribute('disabled');
            if (wasReadonly) element.removeAttribute('readonly');
            if (wasDisabled) element.removeAttribute('disabled');

            if (element.isContentEditable) { element.innerText = ''; }
            else { element.value = ''; }

            try { document.execCommand('insertText', false, value); }
            catch (e) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                const textAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                if (element.tagName === 'TEXTAREA' && textAreaSetter) textAreaSetter.call(element, value);
                else if (setter) setter.call(element, value);
            }

            if (wasReadonly) element.setAttribute('readonly', 'readonly');
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }

        element.dispatchEvent(new Event('blur', { bubbles: true }));
        element.style.backgroundColor = '#e6ffed';
    }

    // ==========================================
    // 3. AI 调用
    // ==========================================
    async function callAI(prompt) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: config.apiUrl.trim(),
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey.trim()}` },
                data: JSON.stringify({
                    model: config.model.trim(),
                    messages: [
                        { role: "system", content: "你是资深HR自动化助手。你必须严格返回合法的 JSON 对象。不要输出任何其他解释性废话。" },
                        { role: "user", content: prompt }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.1
                }),
                onload: (res) => {
                    if (res.status !== 200) reject(new Error("API 错误: " + res.status));
                    else resolve(JSON.parse(JSON.parse(res.responseText).choices[0].message.content));
                },
                onerror: reject
            });
        });
    }

    // ==========================================
    // 4. 主流程
    // ==========================================
    async function startProcess() {
        if (!config.apiKey) return alert("请先配置 API Key");
        if (!resumeData) return alert("简历内容为空，请先在下方输入框粘贴简历！");

        updateBtnStatus("AI 正在扫描表单特征...", true);

        const allHeaders = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, .module-title, .section-title, strong, b'))
            .filter(el => {
                const r = el.getBoundingClientRect();
                return (r.height > 0 || r.width > 0) && el.innerText.trim().length > 1 && el.innerText.trim().length < 25;
            })
            .map(el => ({ text: el.innerText.trim().replace(/\n/g, ' '), y: el.getBoundingClientRect().top + window.scrollY }));

        const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"]), textarea, select, [contenteditable="true"]'))
            .filter(el => el.offsetParent !== null || el.getClientRects().length > 0);

        let appearanceCount = {};

        const taskFields = fields.map((el, i) => {
            const id = `f_${i}`;
            el.setAttribute('data-ai-id', id);

            const inputY = el.getBoundingClientRect().top + window.scrollY;
            let sectionTitle = "全局基础信息";
            const validHeaders = allHeaders.filter(h => h.y < inputY - 5);
            if (validHeaders.length > 0) {
                validHeaders.sort((a, b) => b.y - a.y);
                sectionTitle = validHeaders[0].text;
            }

            let contextBlock = el.closest('.form-item, .m-form-item, .el-form-item, .ant-form-item, .form-group, tr');
            if (!contextBlock) contextBlock = el.closest('div');
            let contextLabel = contextBlock?.innerText?.replace(/\s+/g, ' ').substring(0, 30) || "";
            let directLabel = el.placeholder || el.name || el.id || el.getAttribute('aria-label') || "";

            const fieldKey = `${sectionTitle}-${directLabel || contextLabel}`;
            appearanceCount[fieldKey] = (appearanceCount[fieldKey] || 0) + 1;
            const sequenceTag = appearanceCount[fieldKey] > 1 ? ` (本模块第${appearanceCount[fieldKey]}次出现该字段)` : '';

            return {
                id,
                tagName: el.tagName === 'DIV' ? 'TEXTAREA' : el.tagName,
                label: directLabel,
                context: `[所属模块：${sectionTitle}] - ${contextLabel}${sequenceTag}`
            };
        });

        if(taskFields.length === 0) {
            alert("未检测到任何可填写的输入框！");
            updateBtnStatus("⚡ 一键智能填写", false);
            return;
        }

        const fillPrompt = `【我的简历文本】：\n${resumeData}\n\n【待填表单项 (按网页从上到下的视觉顺序排布)】：\n${JSON.stringify(taskFields)}\n
        严格遵守以下填充与推断规则：
        1. 【多组数据对齐】：如果 context 中提示了“(本模块第 N 次出现)”，说明网页上有多个项目/多段经历。你必须将简历中的“第一段经历”填入第1次出现的字段，“第二段经历”填入第2次出现的字段，绝不能把同一个时间或名字重复填满所有组！如果简历里只有1个项目，但网页有3组输入框，多出来的组请返回 ""（空字符串）。
        2. 【下拉选项】：'INPUT'或'SELECT' 如果遇到诸如性别、学历、政治面貌等，请提取最标准的短词（如"本科"、"男"、"中共党员"）。
        3. 【日期格式强制规范】：所有的开始时间、结束时间，强制输出为 \`YYYY-MM\` 格式（如 \`2021-09\`）。如果简历写的是“至今”，请推算为当前真实年月。绝不能输出包含“年”“月”的中文。
        4. 【长文本扩展】：'TEXTAREA' 代表大段文本框，必须完整保留换行符（使用 \\n）和所有细节，绝不要擅自缩减字数！
        5. 【谨慎度提升】：如果不确定某个字段填什么，或者简历里根本没有相关信息，请直接返回 ""（空字符串），不要瞎编乱造。

        返回 JSON 格式：{"f_0": "值", "f_1": "值"}`;

        try {
            const mapping = await callAI(fillPrompt);
            let done = 0;
            for (const id in mapping) {
                const el = document.querySelector(`[data-ai-id="${id}"]`);
                if (el && mapping[id] && mapping[id] !== "null" && mapping[id] !== "") {
                    await ultimateFill(el, String(mapping[id]));
                    done++;
                }
            }
            updateBtnStatus(`成功填充 ${done} 项`, false);
            setTimeout(() => updateBtnStatus("⚡ 一键智能填写", false), 3000);
        } catch (e) {
            alert("执行失败: " + e.message);
            updateBtnStatus("⚡ 一键智能填写", false);
        }
    }

    function updateBtnStatus(t, d) {
        const b = document.querySelector('#ai-resume-host').shadowRoot.querySelector('#btn-fill');
        if(b) { b.innerText = t; b.disabled = d; }
    }

    // ==========================================
    // 5. 极简 UI + 悬浮球模式
    // ==========================================
    function createUI() {
        const host = document.createElement('div');
        host.id = 'ai-resume-host';
        host.style.position = 'fixed'; host.style.top = '60px'; host.style.right = '20px'; host.style.zIndex = '2147483647';
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
            .hidden { display: none !important; }
            .mini-btn { width: 44px; height: 44px; border-radius: 50%; background: #1a73e8; color: white; display: flex; align-items: center; justify-content: center; font-size: 22px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); cursor: move; user-select: none; transition: background 0.2s;}
            .mini-btn:hover { background: #1557b0; }
            .panel { width: 320px; background: #fff; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.15); font-family: system-ui; border: 1px solid #eee; overflow:hidden;}
            .header { background: #1a73e8; color: #fff; padding: 12px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none;}
            .content { padding: 15px; }
            .settings { display: none; padding: 10px; background: #f9f9f9; border-bottom: 1px solid #eee; }
            .settings.show { display: block; }
            input, textarea { width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
            .btn { width: 100%; padding: 10px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; background: #1a73e8; color: white; transition: 0.2s;}
            .btn:hover { background: #1557b0; }
            .btn:disabled { background: #ccc; cursor: not-allowed; }
        `;
        shadow.appendChild(style);

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div id="mini-btn" class="mini-btn ${uiState.minimized ? '' : 'hidden'}" title="点击展开，长按拖拽">🤖</div>

            <div class="panel ${uiState.minimized ? 'hidden' : ''}" id="main-panel">
                <div class="header" id="drag-handle">
                    <span>🤖 AI Resume V2.4</span>
                    <div>
                        <span id="set-icon" style="cursor:pointer; margin-right:8px;" title="设置">⚙️</span>
                        <span id="min-icon" style="cursor:pointer" title="最小化">➖</span>
                    </div>
                </div>
                <div class="settings" id="set-ui">
                    <input type="text" id="url" placeholder="API URL" value="${config.apiUrl}">
                    <input type="text" id="mdl" placeholder="Model" value="${config.model}">
                    <input type="password" id="key" placeholder="API Key" value="${config.apiKey}">
                    <button class="btn" id="save-set" style="background:#34a853">保存配置</button>
                </div>
                <div class="content">
                    <textarea id="txt" rows="6" placeholder="请在此粘贴你的纯文本简历...">${resumeData}</textarea>
                    <button class="btn" id="btn-fill">⚡ 一键智能填写</button>
                </div>
            </div>
        `;
        shadow.appendChild(wrapper);

        // 设置、保存、填写逻辑
        shadow.querySelector('#set-icon').onclick = () => shadow.querySelector('#set-ui').classList.toggle('show');
        shadow.querySelector('#save-set').onclick = () => {
            config.apiUrl = shadow.querySelector('#url').value;
            config.model = shadow.querySelector('#mdl').value;
            config.apiKey = shadow.querySelector('#key').value;
            GM_setValue('ai_resume_config', config);
            alert("配置已保存");
            shadow.querySelector('#set-ui').classList.remove('show');
        };
        shadow.querySelector('#btn-fill').onclick = startProcess;
        shadow.querySelector('#txt').addEventListener('input', (e) => {
            resumeData = e.target.value;
            GM_setValue('ai_resume_data', resumeData);
        });
        shadow.querySelector('#btn-fill').addEventListener('mousedown', () => {
            resumeData = shadow.querySelector('#txt').value;
            GM_setValue('ai_resume_data', resumeData);
        });

        // =======================
        // 拖拽与切换逻辑
        // =======================
        let isDragging = false, isMouseDown = false, ox, oy;

        const onMouseDown = (e) => {
            isMouseDown = true;
            isDragging = false;
            ox = e.clientX - host.offsetLeft;
            oy = e.clientY - host.offsetTop;
        };

        shadow.querySelector('#drag-handle').addEventListener('mousedown', onMouseDown);
        shadow.querySelector('#mini-btn').addEventListener('mousedown', onMouseDown);

        document.addEventListener('mousemove', (e) => {
            if (isMouseDown) {
                isDragging = true;
                host.style.right = 'auto';
                host.style.left = (e.clientX - ox) + 'px';
                host.style.top = (e.clientY - oy) + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            isMouseDown = false;
            // 延迟清除拖拽状态，防止触发点击事件
            setTimeout(() => isDragging = false, 50);
        });

        // 展开面板
        shadow.querySelector('#mini-btn').onclick = (e) => {
            if (isDragging) return; // 如果刚才是在拖拽，就不会触发展开
            shadow.querySelector('#mini-btn').classList.add('hidden');
            shadow.querySelector('#main-panel').classList.remove('hidden');
            GM_setValue('ai_resume_ui_state', { minimized: false });
        };

        // 最小化面板
        shadow.querySelector('#min-icon').onclick = () => {
            shadow.querySelector('#main-panel').classList.add('hidden');
            shadow.querySelector('#mini-btn').classList.remove('hidden');
            GM_setValue('ai_resume_ui_state', { minimized: true });
        };
    }

    setTimeout(createUI, 1000);
})();
