/**
 * FeHelper Json Format Tools
 */

// 一些全局变量
let editor = {};
let LOCAL_KEY_OF_LAYOUT = 'local-layout-key';
let JSON_LINT = 'jsonformat:json-lint-switch';
let EDIT_ON_CLICK = 'jsonformat:edit-on-click';
let AUTO_DECODE = 'jsonformat:auto-decode';

new Vue({
    el: '#pageContainer',
    data: {
        defaultResultTpl: '<div class="x-placeholder"><img src="../json-format/json-demo.jpg" alt="json-placeholder"></div>',
        placeHolder: '',
        jsonFormattedSource: '',
        errorMsg: '',
        errorJsonCode: '',
        errorPos: '',
        jfCallbackName_start: '',
        jfCallbackName_end: '',
        jsonLintSwitch: true,
        autoDecode: false,
        fireChange: true,
        overrideJson: false
    },
    mounted: function () {
        // 自动开关灯控制
        DarkModeMgr.turnLightAuto();

        this.placeHolder = this.defaultResultTpl;

        this.autoDecode = localStorage.getItem(AUTO_DECODE);
        this.autoDecode = this.autoDecode === 'true';

        this.jsonLintSwitch = (localStorage.getItem(JSON_LINT) !== 'false');
        this.overrideJson = (localStorage.getItem(EDIT_ON_CLICK) === 'true');
        this.changeLayout(localStorage.getItem(LOCAL_KEY_OF_LAYOUT));

        editor = CodeMirror.fromTextArea(this.$refs.jsonBox, {
            mode: "text/javascript",
            lineNumbers: true,
            matchBrackets: true,
            styleActiveLine: true,
            lineWrapping: true
        });

        //输入框聚焦
        editor.focus();

        // 格式化以后的JSON，点击以后可以重置原内容
        window._OnJsonItemClickByFH = (jsonTxt) => {
            if (this.overrideJson) {
                this.disableEditorChange(jsonTxt);
            }
        };
        editor.on('change', (editor, changes) => {
            this.jsonFormattedSource = editor.getValue().replace(/\n/gm, ' ');
            this.fireChange && this.format();
        });

        // 在tab创建或者更新时候，监听事件，看看是否有参数传递过来
        if (location.protocol === 'chrome-extension:') {
            chrome.tabs.query({currentWindow: true,active: true, }, (tabs) => {
                let activeTab = tabs.filter(tab => tab.active)[0];
                chrome.runtime.sendMessage({
                    type: 'fh-dynamic-any-thing',
                    thing: 'request-page-content',
                    tabId: activeTab.id
                }).then(resp => {
                    if(!resp || !resp.content) return ;
                    editor.setValue(resp.content || '');
                    this.format();
                });
            });
        }
    },
    methods: {
        format: function () {
            this.errorMsg = '';
            this.placeHolder = this.defaultResultTpl;
            this.jfCallbackName_start = '';
            this.jfCallbackName_end = '';

            let source = editor.getValue().replace(/\n/gm, ' ');
            if (!source) {
                return false;
            }

            // JSONP形式下的callback name
            let funcName = null;
            // json对象
            let jsonObj = null;

            // 下面校验给定字符串是否为一个合法的json
            try {
                // 再看看是不是jsonp的格式
                let reg = /^([\w\.]+)\(\s*([\s\S]*)\s*\)$/igm;
                let matches = reg.exec(source);
                if (matches != null) {
                    funcName = matches[1];
                    source = matches[2];
                }
                // 这里可能会throw exception
                jsonObj = JSON.parse(source);

            } catch (ex) {
                // new Function的方式，能自动给key补全双引号，但是不支持bigint，所以是下下策，放在try-catch里搞
                try {
                    jsonObj = new Function("return " + source)();
                } catch (exx) {
                    try {
                        // 再给你一次机会，是不是下面这种情况：  "{\"ret\":\"0\", \"msg\":\"ok\"}"
                        jsonObj = new Function("return '" + source + "'")();
                        if (typeof jsonObj === 'string') {
                            try {
                                // 确保bigint不会失真
                                jsonObj = JSON.parse(jsonObj);
                            } catch (ie) {
                                // 最后给你一次机会，是个字符串，老夫给你再转一次
                                jsonObj = new Function("return " + jsonObj)();
                            }
                        }
                    } catch (exxx) {
                        this.errorMsg = exxx.message;
                    }
                }
            }

            try{
                // 这里多做一个动作，给没有携带双引号的Key都自动加上，防止Long类型失真
                const regex = /([{,]\s*)(\w+)(\s*:)/g;
                source = source.replace(regex, '$1"$2"$3');
                jsonObj = JSON.parse(source);
            }catch(e){
                // 这里什么动作都不需要做，这种情况下转换失败的，肯定是Value被污染了，抛弃即可
            }

            // 是json格式，可以进行JSON自动格式化
            if (jsonObj != null && typeof jsonObj === "object" && !this.errorMsg.length) {
                try {
                    let sortType = document.querySelectorAll('[name=jsonsort]:checked')[0].value;
                    if (sortType !== '0') {
                        jsonObj = JsonABC.sortObj(jsonObj, parseInt(sortType), true);
                    }
                    source = JSON.stringify(jsonObj);
                } catch (ex) {
                    // 通过JSON反解不出来的，一定有问题
                    this.errorMsg = ex.message;
                }

                if (!this.errorMsg.length) {

                    if (this.autoDecode) {
                        (async () => {
                            let txt = await JsonEnDecode.urlDecodeByFetch(source);
                            source = JsonEnDecode.uniDecode(txt);
                            Formatter.format(source);
                        })();
                    } else {
                        Formatter.format(source);
                    }

                    this.placeHolder = '';
                    this.jsonFormattedSource = source;

                    // 如果是JSONP格式的，需要把方法名也显示出来
                    if (funcName != null) {
                        this.jfCallbackName_start = funcName + '(';
                        this.jfCallbackName_end = ')';
                    } else {
                        this.jfCallbackName_start = '';
                        this.jfCallbackName_end = '';
                    }

                    this.$nextTick(() => {
                        this.updateWrapperHeight();
                    })
                }
            }

            if (this.errorMsg.length) {
                if (this.jsonLintSwitch) {
                    return this.lintOn();
                } else {
                    this.placeHolder = '<span class="x-error">' + this.errorMsg + '</span>';
                    return false;
                }
            }

            return true;
        },

        compress: function () {
            if (this.format()) {
                let jsonTxt = this.jfCallbackName_start + this.jsonFormattedSource + this.jfCallbackName_end;
                this.disableEditorChange(jsonTxt);
            }
        },

        autoDecodeFn: function () {
            this.$nextTick(() => {
                localStorage.setItem(AUTO_DECODE, this.autoDecode);
                this.format();
            });
        },

        uniEncode: function () {
            editor.setValue(JsonEnDecode.uniEncode(editor.getValue()));
        },

        uniDecode: function () {
            editor.setValue(JsonEnDecode.uniDecode(editor.getValue()));
        },

        urlDecode: function () {
            JsonEnDecode.urlDecodeByFetch(editor.getValue()).then(text => editor.setValue(text));
        },

        removeEscapes: function () {
            let source = editor.getValue();
            if (!source.trim()) {
                alert('请先输入JSON内容');
                return;
            }
            
            try {
                let processed = this.processEscapeChars(source);
                this.disableEditorChange(processed);
                this.format(); // 触发重新格式化
            } catch (error) {
                alert('处理过程中发生错误：' + error.message);
            }
        },

        processEscapeChars: function (jsonString) {
            if (!jsonString) {
                return jsonString || '';
            }
            if (typeof jsonString !== 'string') {
                return jsonString;
            }
            
            let result = '';
            let i = 0;
            
            while (i < jsonString.length) {
                if (jsonString[i] === '\\' && i + 1 < jsonString.length) {
                    let nextChar = jsonString[i + 1];
                    // 处理常见的转义字符
                    switch (nextChar) {
                        case '"':  // 双引号转义
                        case "'":  // 单引号转义
                        case '/':  // 斜杠转义
                            result += nextChar;
                            i += 2; // 跳过反斜杠和下一个字符
                            break;
                        case '\\': // 双反斜杠转义，保留一个
                            result += '\\';
                            i += 2;
                            break;
                        case 'n':  // 换行符转义
                            result += '\n';
                            i += 2;
                            break;
                        case 't':  // 制表符转义
                            result += '\t';
                            i += 2;
                            break;
                        case 'r':  // 回车符转义
                            result += '\r';
                            i += 2;
                            break;
                        case 'b':  // 退格符转义
                            result += '\b';
                            i += 2;
                            break;
                        case 'f':  // 换页符转义
                            result += '\f';
                            i += 2;
                            break;
                        default:
                            // 不是识别的转义字符，保留原样
                            result += jsonString[i];
                            i++;
                            break;
                    }
                } else {
                    result += jsonString[i];
                    i++;
                }
            }
            
            return result;
        },

        updateWrapperHeight: function () {
            let curLayout = localStorage.getItem(LOCAL_KEY_OF_LAYOUT);
            let elPc = document.querySelector('#pageContainer');
            if (curLayout === 'up-down') {
                elPc.style.height = 'auto';
            } else {
                elPc.style.height = Math.max(elPc.scrollHeight, document.body.scrollHeight) + 'px';
            }
        },

        changeLayout: function (type) {
            let elPc = document.querySelector('#pageContainer');
            if (type === 'up-down') {
                elPc.classList.remove('layout-left-right');
                elPc.classList.add('layout-up-down');
                this.$refs.btnLeftRight.classList.remove('selected');
                this.$refs.btnUpDown.classList.add('selected');
            } else {
                elPc.classList.remove('layout-up-down');
                elPc.classList.add('layout-left-right');
                this.$refs.btnLeftRight.classList.add('selected');
                this.$refs.btnUpDown.classList.remove('selected');
            }
            localStorage.setItem(LOCAL_KEY_OF_LAYOUT, type);
            this.updateWrapperHeight();
        },

        setCache: function () {
            this.$nextTick(() => {
                localStorage.setItem(EDIT_ON_CLICK, this.overrideJson);
            });
        },

        lintOn: function () {
            this.$nextTick(() => {
                localStorage.setItem(JSON_LINT, this.jsonLintSwitch);
            });
            if (!editor.getValue().trim()) {
                return true;
            }
            this.$nextTick(() => {
                if (!this.jsonLintSwitch) {
                    return;
                }
                let lintResult = JsonLint.lintDetect(editor.getValue());
                if (!isNaN(lintResult.line)) {
                    this.placeHolder = '<div id="errorTips">' +
                        '<div id="tipsBox">错误位置：' + (lintResult.line + 1) + '行，' + (lintResult.col + 1) + '列；缺少字符或字符不正确</div>' +
                        '<div id="errorCode">' + lintResult.dom + '</div></div>';
                }
            });
            return false;
        },

        disableEditorChange: function (jsonTxt) {
            this.fireChange = false;
            this.$nextTick(() => {
                editor.setValue(jsonTxt);
                this.$nextTick(() => {
                    this.fireChange = true;
                })
            })
        },

        openOptionsPage: function(){
            chrome.runtime.openOptionsPage();
        },

        setDemo: function () {
            let demo = '{"BigIntSupported":995815895020119788889,"date":"20180322","message":"Success !","status":200,"city":"北京","count":632,"data":{"shidu":"34%","pm25":73,"pm10":91,"quality":"良","wendu":"5","ganmao":"极少数敏感人群应减少户外活动","yesterday":{"date":"21日星期三","sunrise":"06:19","high":"高温 11.0℃","low":"低温 1.0℃","sunset":"18:26","aqi":85,"fx":"南风","fl":"<3级","type":"多云","notice":"阴晴之间，谨防紫外线侵扰"},"forecast":[{"date":"22日星期四","sunrise":"06:17","high":"高温 17.0℃","low":"低温 1.0℃","sunset":"18:27","aqi":98,"fx":"西南风","fl":"<3级","type":"晴","notice":"愿你拥有比阳光明媚的心情"},{"date":"23日星期五","sunrise":"06:16","high":"高温 18.0℃","low":"低温 5.0℃","sunset":"18:28","aqi":118,"fx":"无持续风向","fl":"<3级","type":"多云","notice":"阴晴之间，谨防紫外线侵扰"},{"date":"24日星期六","sunrise":"06:14","high":"高温 21.0℃","low":"低温 7.0℃","sunset":"18:29","aqi":52,"fx":"西南风","fl":"<3级","type":"晴","notice":"愿你拥有比阳光明媚的心情"},{"date":"25日星期日","sunrise":"06:13","high":"高温 22.0℃","low":"低温 7.0℃","sunset":"18:30","aqi":71,"fx":"西南风","fl":"<3级","type":"晴","notice":"愿你拥有比阳光明媚的心情"},{"date":"26日星期一","sunrise":"06:11","high":"高温 21.0℃","low":"低温 8.0℃","sunset":"18:31","aqi":97,"fx":"西南风","fl":"<3级","type":"多云","notice":"阴晴之间，谨防紫外线侵扰"}]}}';
            editor.setValue(demo);
            this.$nextTick(() => {
                this.format();
            })
        }
    }
});
