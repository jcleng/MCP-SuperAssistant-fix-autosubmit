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

    // 存储已处理的call_id，避免重复处理
    const processedCallIds = new Set();

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

    // 解析jsonl到rpc
    function convertJSONLtoJSONRPC(jsonlData) {
        const lines = jsonlData;
        let result = {
            jsonrpc: "2.0",
            id: null,
            method: "",
            params: {
                name: "",
                arguments: {},
            },
        };

        let currentCallId = null;
        let functionName = "";
        let description = "";

        for (const line of lines) {
            try {
                const obj = line;

                switch (obj.type) {
                    case "function_call_start":
                        currentCallId = obj.call_id;
                        functionName = obj.name;
                        result.id = currentCallId;
                        result.method = "tools/call";
                        result.params.name = functionName;
                        break;

                    case "description":
                        description = obj.text;
                        // 可以将描述作为元数据添加到params中
                        if (!result.params.arguments) {
                            result.params.arguments = {};
                        }
                        result.params.arguments._description = description;
                        break;

                    case "parameter":
                        if (!result.params.arguments) {
                            result.params.arguments = {};
                        }
                        result.params.arguments[obj.key] = obj.value;
                        break;

                    case "function_call_end":
                        // 验证call_id是否匹配
                        if (currentCallId !== obj.call_id) {
                            console.warn(
                                `警告: 函数调用结束的ID不匹配: ${currentCallId} !== ${obj.call_id}`
                            );
                        }
                        break;

                    default:
                        console.warn(`未知的事件类型: ${obj.type}`);
                }
            } catch (error) {
                console.error(`解析JSONL行失败: ${line}`, error);
            }
        }

        return result;
    }

    // 执行请求
    async function callMCPWithJSONRPC(exampleJSONL, callback) {
        const serverUrl = "http://localhost:3006/mcp";

        const jsonRpcRequest = convertJSONLtoJSONRPC(exampleJSONL);

        // 检查是否已处理过此call_id
        if (jsonRpcRequest.id && processedCallIds.has(jsonRpcRequest.id)) {
            console.log(`已处理过call_id: ${jsonRpcRequest.id}，跳过`);
            return null;
        }

        console.log("发送JSON-RPC请求:");
        console.log(JSON.stringify(jsonRpcRequest, null, 2));

        try {
            const response = await fetch(serverUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/event-stream",
                },
                body: JSON.stringify(jsonRpcRequest),
            });

            console.log("\n响应状态:", response.status);

            const contentType = response.headers.get("content-type") || "";
            console.log("内容类型:", contentType);

            let resultText = "";

            if (contentType.includes("text/event-stream")) {
                // 处理SSE
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullResponse = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    fullResponse += chunk;

                    // 解析SSE事件
                    const lines = chunk.split("\n");
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            const dataStr = line.substring(6).trim();
                            if (dataStr && dataStr !== "[DONE]") {
                                try {
                                    const data = JSON.parse(dataStr);
                                    console.log("解析的数据:", data);
                                    // 收集结果文本
                                    if (data.result && data.result.content) {
                                        for (const content of data.result.content) {
                                            if (content.text) {
                                                resultText += content.text;
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.log("原始数据:", dataStr);
                                }
                            }
                        }
                    }
                }

                // 如果有回调函数并且有结果文本，调用回调
                if (callback && typeof callback === 'function' && resultText) {
                    callback(resultText);
                }
            } else {
                // 处理普通JSON响应
                const result = await response.json();
                console.log("\n响应结果:");
                console.log(JSON.stringify(result, null, 2));

                // 提取结果文本
                if (result && result.result && result.result.content) {
                    for (const content of result.result.content) {
                        if (content.text) {
                            resultText = content.text;
                            break;
                        }
                    }
                }

                // 如果有回调函数并且有结果文本，调用回调
                if (callback && typeof callback === 'function' && resultText) {
                    callback(resultText);
                }
            }

            // 标记为已处理
            if (jsonRpcRequest.id) {
                processedCallIds.add(jsonRpcRequest.id);
            }

            return resultText;
        } catch (error) {
            console.error("调用失败:", error);
            return null;
        }
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

            const lastResponseMessage = responseMessages[responseMessages.length - 1];
            // 获取所有pre标签
            const preElements = lastResponseMessage.querySelectorAll('.view-line');

            if (preElements.length === 0) {
                console.log('未找到pre元素');
                return;
            }


            // 将所有pre标签的内容拼接起来
            let jsonlDataArr = [];
            for (let i = 0; i < preElements.length; i++) {
                const element = preElements[i];
                let elementText = element.innerText
                if (elementText && elementText !== '') {
                    jsonlDataArr.push(JSON.parse(elementText.replace(/“/g, '"')
                        .replace(/”/g, '"')
                        .replace(/＂/g, '"')
                        // 替换全角逗号为半角逗号
                        .replace(/，/g, ',')
                        .replace(/　/g, ' ')
                        // 替换全角空格为半角空格
                        .replace(/\u3000/g, ' ')
                        .replace(/\u00A0/g, ' ')));
                    // 如果不是第一个元素，添加换行符
                }
            }


            console.log('找到JSONL数据:', jsonlDataArr);

            // 从JSONL中提取call_id
            try {
                const lines = jsonlDataArr
                console.log('lines', lines);

                let callId = null;


                for (const _key in lines) {
                    const line = lines[_key];
                    console.log('⭕', line);
                    const obj = line;
                    console.log('找到obj数据:', obj);
                    if (obj.type === "function_call_start") {
                        callId = obj.call_id;
                        break;
                    }
                }

                if (callId) {
                    // 检查是否已处理过
                    if (processedCallIds.has(callId)) {
                        console.log(`call_id ${callId} 已处理过，跳过`);
                        return;
                    }

                    // 调用MCP服务
                    callMCPWithJSONRPC(jsonlDataArr, (resultText) => {
                        console.log('MCP调用完成，调用回调函数');
                        findAndInsertText(resultText);
                    });
                } else {
                    console.log('未找到call_id，跳过');
                }
            } catch (parseError) {
                console.error('解析JSONL数据失败:', parseError);
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
