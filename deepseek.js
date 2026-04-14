// ==UserScript==
// @name        MCP SuperAssistant(chat.deepseek.com)自动提交
// @namespace   http://tampermonkey.net/
// @version     1.0
// @description 监视function-result-success类中的文本变化并自动插入到textarea
// @author      You
// @match       https://chat.deepseek.com/*
// @grant       none
// ==/UserScript==

(function () {
    'use strict';

    // 存储上一次获取到的文本
    let lastText = '';

    // 创建自定义样式
    const style = document.createElement('style');
    style.textContent = `
        .text-monitor-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            z-index: 999999;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            font-size: 14px;
            animation: fadeInOut 3s ease-in-out;
        }

        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateY(-20px); }
            20% { opacity: 1; transform: translateY(0); }
            80% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(-20px); }
        }
    `;
    document.head.appendChild(style);

    // 显示通知函数
    function showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'text-monitor-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        // 3秒后移除通知
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    // 查找目标元素并插入文本
    function findAndInsertText(text) {
        text = `<function_result>${text}</function_result>`;
        const textareas = document.querySelectorAll('textarea');

        if (textareas.length === 0) {
            console.log('未找到textarea元素');
            return false;
        }

        for (let i = 0; i < textareas.length; i++) {
            const textarea = textareas[i];
            console.log('尝试插入到textarea:', i);

            try {
                textarea.focus();
                document.execCommand('insertText', false, text);
                console.log('通过execCommand插入成功');
                showNotification(`已插入文本!"`);
                // 触发键盘回车事件
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                });
                textarea.dispatchEvent(enterEvent);
                return true;

            } catch (error) {
                console.error(`插入textarea[${i}]时出错:`, error);

                // 备用方案：尝试通过 execCommand
                try {
                    textarea.focus();
                    document.execCommand('insertText', false, text);
                    console.log('通过execCommand插入成功');
                    return true;
                } catch (e) {
                    console.error('execCommand也失败:', e);
                }
            }
        }

        console.log('所有尝试失败');
        return false;
    }
    // 模拟单个字符输入
    function simulateKeyInput(element, char) {
        // 获取焦点
        element.focus();

        // 模拟 keydown
        const keydownEvent = new KeyboardEvent('keydown', {
            key: char,
            code: 'Key' + char.toUpperCase(),
            keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0),
            bubbles: true,
            cancelable: true
        });
        element.dispatchEvent(keydownEvent);

        // 模拟 keypress
        const keypressEvent = new KeyboardEvent('keypress', {
            key: char,
            charCode: char.charCodeAt(0),
            keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0),
            bubbles: true,
            cancelable: true
        });
        element.dispatchEvent(keypressEvent);

        // 更新值
        const start = element.selectionStart;
        const end = element.selectionEnd;
        element.value = element.value.substring(0, start) + char + element.value.substring(end);
        element.selectionStart = element.selectionEnd = start + 1;

        // 模拟 input
        const inputEvent = new InputEvent('input', {
            inputType: 'insertText',
            data: char,
            bubbles: true,
            cancelable: true
        });
        element.dispatchEvent(inputEvent);

        // 模拟 keyup
        const keyupEvent = new KeyboardEvent('keyup', {
            key: char,
            code: 'Key' + char.toUpperCase(),
            keyCode: char.charCodeAt(0),
            which: char.charCodeAt(0),
            bubbles: true,
            cancelable: true
        });
        element.dispatchEvent(keyupEvent);

        // 模拟 change
        const changeEvent = new Event('change', { bubbles: true });
        element.dispatchEvent(changeEvent);
    }

    // 主监控函数
    function monitorTextChanges() {
        // 查找所有function-result-success类的元素
        const elements = document.querySelectorAll('.function-result-success');

        if (elements.length === 0) {
            console.log('未找到.function-result-success元素');
            return;
        }

        // 获取所有元素的文本（合并多个元素的内容）
        let currentText = '';
        elements.forEach((element, index) => {
            const text = element.textContent.trim();
            if (text) {
                if (index + 1 == elements.length) {
                    currentText = text;
                }
            }
        });

        // 如果文本有变化且不为空
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
    }

    // 启动监控
    console.log('文本变化监视器已启动');
    showNotification('文本监视器已启动');

    // 每3秒检查一次
    setInterval(monitorTextChanges, 3000);

    // 立即执行一次
    setTimeout(monitorTextChanges, 1000);

    // 添加手动触发按钮（可选，调试用）
    const triggerButton = document.createElement('button');
    triggerButton.textContent = '手动触发';
    triggerButton.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        padding: 10px 15px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 12px;
    `;

    triggerButton.addEventListener('click', function () {
        monitorTextChanges();
        showNotification('手动触发检测');
    });

    document.body.appendChild(triggerButton);

})();
