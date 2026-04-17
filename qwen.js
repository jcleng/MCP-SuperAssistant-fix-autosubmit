// ==UserScript==
// @name         直接调用MCP
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  获取jsonl数据执行任务
// @author       You
// @match        https://chat.qwen.ai/*
// @grant        none
// ==/UserScript==

/**
 * 自动执行和提交脚本
 * 功能：每隔3秒获取网页元素并自动操作
 */
(function () {
    'use strict';
    let lastText = '';
    // 用于存储已点击过的 call-id，避免重复点击
    const clickedCallIds = new Set();
    // 查找并插入文本到输入框
    function findAndInsertText(text) {
        text = `<function_result>${text}</function_result>`;
        const textareas = document.querySelectorAll('.message-input-textarea');

        if (textareas.length === 0) {
            console.log('未找到textarea元素');
            return false;
        }
        console.log('textareas.length', textareas.length);

        for (let i = 0; i < textareas.length; i++) {
            const textarea = textareas[i];
            console.log('尝试插入到textarea:', i);

            try {
                textarea.focus();
                document.execCommand('insertText', false, text);
                console.log('通过execCommand插入成功');

                // 触发键盘回车事件
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    keyCode: 13,
                    code: 'Enter',
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                setTimeout(() => {
                    textarea.focus();
                    textarea.dispatchEvent(enterEvent);
                    console.log('回车');
                }, 3000);
                return true;

            } catch (error) {
                console.error(`插入textarea[${i}]时出错:`, error);
            }
        }

        console.log('所有尝试失败');
        return false;
    }



    /**
     * 主循环函数
     */
    function mainLoop() {
        try {
            // 查找最后一个具有chat-response-message-right类的元素
            const responseMessages = document.querySelectorAll('.chat-response-message-right');

            if (responseMessages.length === 0) {
                console.log('未找到.chat-response-message-right元素');
                return;
            }

            const lastSegment = responseMessages[responseMessages.length - 1];
            // 2. 获取该元素内的 .call-id
            const callIdElement = lastSegment.querySelector('.call-id');
            if (!callIdElement) {
                console.log('[AutoScript] 未找到 .call-id 元素');
                return;
            }

            const callId = callIdElement.textContent.trim();
            if (!callId) {
                console.log('[AutoScript] call-id 值为空');
                return;
            }

            console.log('[AutoScript] 获取到 call-id:', callId);

            // 3. 检查是否已点击过，避免重复点击
            if (clickedCallIds.has(callId)) {
                console.log('[AutoScript] call-id', callId, '已点击过，跳过');
            } else {
                // 4. 点击 .execute-button
                const executeButton = lastSegment.querySelector('.execute-button');
                if (executeButton) {
                    console.log('[AutoScript] 点击执行按钮');
                    executeButton.click();
                    clickedCallIds.add(callId);
                } else {
                    console.log('[AutoScript] 未找到 .execute-button 按钮');
                }
            }

            // 5. 获取 .function-result-success 的最后一个值
            const successResults = document.querySelectorAll('.function-result-success');
            if (successResults.length === 0) {
                console.log('[AutoScript] 未找到 .function-result-success 元素');
                return;
            }

            const lastSuccessResult = successResults[successResults.length - 1];
            const currentText = lastSuccessResult.textContent.trim();

            console.log('[AutoScript] 获取到结果值:', currentText);
            if (currentText && currentText !== lastText) {
                console.log('检测到文本变化:', currentText);
                // 尝试插入到textarea
                const inserted = findAndInsertText(currentText);

                if (inserted) {
                    // 更新上次文本记录
                    lastText = currentText;
                } else {
                    console.log('文本变化但插入失败，下次重新尝试');
                }
            }



        } catch (error) {
            console.error('主循环执行出错:', error);
        }
    }

    // 启动定时器，每3秒执行一次
    console.log('[AutoScript] 脚本已启动，每3秒执行一次');
    setInterval(mainLoop, 3000);

    // 立即执行一次
    mainLoop();
})();
