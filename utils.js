// ============================================================
// 中学体育成绩追踪系统 — 核心工具库 (Supabase REST API)
// 不依赖 Supabase SDK，直接用 fetch() 调用 REST API
// 无需加载任何国外 CDN
// ============================================================
(function () {
  'use strict';

  // --- REST API 配置 ---
  var API_URL = SUPABASE_CONFIG.url + '/rest/v1';
  var API_HEADERS = {
    'apikey': SUPABASE_CONFIG.anonKey,
    'Authorization': 'Bearer ' + SUPABASE_CONFIG.anonKey,
    'Content-Type': 'application/json',
  };

  // ==================== 时间格式转换 ====================

  function timeToSeconds(str) {
    if (str == null) return null;
    if (typeof str === 'number') return str;
    var s = String(str).trim();

    var pureNum = parseFloat(s);
    if (!isNaN(pureNum) && !/[′':"″]/.test(s) && !/^\d+\.\d{1,2}$/.test(s) && pureNum === +s && s.indexOf('.') === -1) {
      return pureNum;
    }

    var m1 = s.match(/^(\d+)\s*['′]\s*([\d.]+)\s*["″]?\s*$/);
    if (m1) return parseInt(m1[1], 10) * 60 + parseFloat(m1[2]);

    var m2 = s.match(/^(\d+):([\d.]+)$/);
    if (m2) return parseInt(m2[1], 10) * 60 + parseFloat(m2[2]);

    var m3 = s.match(/^(\d+)\.(\d{1,2})$/);
    if (m3) {
      var min = parseInt(m3[1], 10);
      var secStr = m3[2];
      var sec = parseInt(secStr, 10);
      if (secStr.length === 1) sec *= 10;
      return min * 60 + sec;
    }

    return isNaN(pureNum) ? null : pureNum;
  }

  function secondsToTime(totalSeconds) {
    if (totalSeconds == null) return '';
    var t = Math.round(totalSeconds);
    var min = Math.floor(t / 60);
    var sec = t % 60;
    return min + "'" + String(sec).padStart(2, '0') + '"';
  }

  // ==================== REST API 数据操作 ====================

  /** 构建查询 URL */
  function buildUrl(table, constraints, extra) {
    var url = API_URL + '/' + table + '?select=*';
    for (var k in constraints) {
      if (constraints[k] !== undefined && constraints[k] !== null) {
        url += '&' + encodeURIComponent(k) + '=eq.' + encodeURIComponent(constraints[k]);
      }
    }
    if (extra) {
      if (extra.descending) url += '&order=' + encodeURIComponent(extra.descending) + '.desc';
      if (extra.ascending) url += '&order=' + encodeURIComponent(extra.ascending) + '.asc';
    }
    var limit = (extra && extra.limit) ? extra.limit : 1000;
    url += '&limit=' + limit;
    return url;
  }

  /** 查询多条 */
  async function sbFind(table, constraints, extra) {
    var url = buildUrl(table, constraints, extra);
    var resp = await fetch(url, { headers: API_HEADERS });
    if (!resp.ok) {
      var msg = '';
      try { var err = await resp.json(); msg = err.message || err.msg || ''; } catch (e) {}
      throw new Error('查询 ' + table + ' 失败 (HTTP ' + resp.status + ') ' + msg);
    }
    return await resp.json();
  }

  /** 查询单条 */
  async function sbGet(table, id) {
    var url = API_URL + '/' + table + '?id=eq.' + encodeURIComponent(id) + '&limit=1';
    var resp = await fetch(url, { headers: API_HEADERS });
    if (!resp.ok) throw new Error('查询 ' + table + ' 失败');
    var data = await resp.json();
    if (!data || data.length === 0) throw new Error(table + ' 记录不存在');
    return data[0];
  }

  /** 创建 */
  async function sbCreate(table, record) {
    var headers = Object.assign({}, API_HEADERS, { 'Prefer': 'return=representation' });
    var resp = await fetch(API_URL + '/' + table, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(record),
    });
    if (!resp.ok) {
      var msg = '';
      try { var err = await resp.json(); msg = err.message || ''; } catch (e) {}
      throw new Error('创建 ' + table + ' 失败 (HTTP ' + resp.status + ') ' + msg);
    }
    // 有些版本不返回数据
    try { var created = await resp.json(); if (created && created.length) return created[0]; } catch (e) {}
    return record;
  }

  /** 更新 */
  async function sbUpdate(table, id, record) {
    var url = API_URL + '/' + table + '?id=eq.' + encodeURIComponent(id);
    var resp = await fetch(url, {
      method: 'PATCH',
      headers: API_HEADERS,
      body: JSON.stringify(record),
    });
    if (!resp.ok) throw new Error('更新 ' + table + ' 失败 (HTTP ' + resp.status + ')');
  }

  /** 删除 */
  async function sbDelete(table, id) {
    var url = API_URL + '/' + table + '?id=eq.' + encodeURIComponent(id);
    var resp = await fetch(url, { method: 'DELETE', headers: API_HEADERS });
    if (!resp.ok) throw new Error('删除 ' + table + ' 失败 (HTTP ' + resp.status + ')');
  }

  // ==================== 评分计算 ====================

  async function getScoreStandards(projectId, gender) {
    var list = await sbFind('ScoreStandard', { project_id: projectId, gender: gender });
    var proj = await sbGet('Project', projectId);
    list.sort(function (a, b) {
      var va = a.threshold_value;
      var vb = b.threshold_value;
      return proj.smaller_is_better ? va - vb : vb - va;
    });
    return list;
  }

  function calculateScore(sortedStandards, actualValue, smallerIsBetter) {
    if (!sortedStandards || sortedStandards.length === 0) return null;
    for (var i = 0; i < sortedStandards.length; i++) {
      var t = sortedStandards[i].threshold_value;
      if (smallerIsBetter && t >= actualValue) return sortedStandards[i].score;
      if (!smallerIsBetter && t <= actualValue) return sortedStandards[i].score;
    }
    return sortedStandards[sortedStandards.length - 1].score;
  }

  // ==================== 训练建议 ====================

  var ADVICE_MAP = {
    '800米跑': [
      '加强耐力跑训练，每周 3-4 次',
      '注意呼吸节奏，建议两步一呼两步一吸',
      '前 600 米保持匀速，最后 200 米全力冲刺',
    ],
    '1000米跑': [
      '加强耐力跑训练，每周 3-4 次',
      '注意呼吸节奏，建议三步一呼三步一吸',
      '前 800 米保持匀速，最后 200 米全力冲刺',
    ],
    '足球运球': [
      '加强运球绕杆练习，提升变向速度',
      '运球时降低重心，用脚内侧 / 外侧交替触球',
      '每天进行障碍折返跑以提升敏捷性',
    ],
    '50米跑': [
      '加强爆发力训练，多做 30-60 米冲刺',
      '改进起跑姿势，重心前移快速蹬地',
      '增加下肢力量训练（深蹲、弓步蹲）',
    ],
    '立定跳远': [
      '加强腿部爆发力：蛙跳、深蹲跳',
      '改进摆臂与起跳的协调配合',
      '练习收腹举腿，延长腾空时间',
    ],
    '一分钟跳绳': [
      '练习手腕摇绳技巧，减少手臂大幅摆动',
      '保持身体正直稳定，用前脚掌着地',
      '每天坚持 3 组 1 分钟限时训练',
    ],
    '掷实心球': [
      '加强上肢和腰腹核心力量训练',
      '改进出手角度（约 38°-42°）',
      '多做背桥、仰卧起坐等核心练习',
    ],
    '篮球运球投篮': [
      '提高运球与投篮之间的连贯性',
      '加强行进间上篮节奏练习',
      '模拟考试路线进行计时训练',
    ],
    '一分钟仰卧起坐': [
      '每天坚持腹肌训练，递增组数',
      '注意动作标准：手指交叉贴脑后，肘触膝',
      '分组训练法：30s 快做 + 30s 休息，循环',
    ],
    '引体向上': [
      '加强背阔肌和肱二头肌力量训练',
      '使用弹力带辅助练习，逐步减少辅助',
      '控制体重，减轻上肢负担',
    ],
    '游泳': [
      '每周至少下水训练 3 次',
      '改进划水效率和呼吸节奏',
      '加强转身和到边技术练习',
    ],
  };

  function generateTrainingAdvice(projectName, score, prevScore) {
    var items = [];
    var base = ADVICE_MAP[projectName] || [];

    if (score === 10) {
      items.push('🎉 恭喜！该项目获得满分，请继续保持！');
    }

    if (prevScore !== null && prevScore !== undefined) {
      if (score > prevScore) {
        items.push('📈 成绩有进步！保持当前训练节奏。');
      } else if (score < prevScore) {
        items.push('⚠️ 成绩出现退步，需要加强训练。');
      }
    }

    items.push.apply(items, base.slice(0, 2));

    if (score <= 3) {
      items.push('💪 当前成绩较低，建议从基础体能开始，坚持每日训练。');
    } else if (score <= 6) {
      items.push('👍 已接近及格水平，针对薄弱环节重点突破。');
    }

    return items;
  }

  // ==================== 数据初始化 ====================

  var DEFAULT_PROJECTS = [
    { name: '800米跑', unit: '秒', smaller_is_better: true, gender_specific: true },
    { name: '1000米跑', unit: '秒', smaller_is_better: true, gender_specific: true },
    { name: '足球运球', unit: '秒', smaller_is_better: true, gender_specific: false },
    { name: '50米跑', unit: '秒', smaller_is_better: true, gender_specific: false },
    { name: '立定跳远', unit: '米', smaller_is_better: false, gender_specific: false },
    { name: '一分钟跳绳', unit: '次', smaller_is_better: false, gender_specific: false },
    { name: '掷实心球', unit: '米', smaller_is_better: false, gender_specific: false },
    { name: '篮球运球投篮', unit: '秒', smaller_is_better: true, gender_specific: false },
    { name: '一分钟仰卧起坐', unit: '个', smaller_is_better: false, gender_specific: true },
    { name: '引体向上', unit: '个', smaller_is_better: false, gender_specific: true },
    { name: '游泳', unit: '米', smaller_is_better: false, gender_specific: false },
  ];

  var FEMALE_STANDARDS = {
    '800米跑': [ [10,205],[9,215],[8,225],[7,235],[6,245],[5,255],[4,265],[3,275],[2,285],[1,295] ],
    '足球运球': [ [10,10.1],[9,11.0],[8,11.9],[7,12.9],[6,14.4],[5,15.4],[4,16.8],[3,17.7],[2,18.6],[1,19.7] ],
    '50米跑': [ [10,8.1],[9,8.3],[8,8.5],[7,8.7],[6,8.9],[5,9.1],[4,9.5],[3,9.9],[2,10.5],[1,10.9] ],
    '立定跳远': [ [10,1.97],[9,1.89],[8,1.81],[7,1.73],[6,1.65],[5,1.57],[4,1.49],[3,1.41],[2,1.33],[1,1.21] ],
    '一分钟跳绳': [ [10,170],[9,160],[8,150],[7,140],[6,130],[5,120],[4,110],[3,100],[2,90],[1,80] ],
    '掷实心球': [ [10,6.70],[9,6.30],[8,5.90],[7,5.50],[6,5.10],[5,4.70],[4,4.30],[3,3.90],[2,3.50],[1,3.10] ],
    '篮球运球投篮': [ [10,26],[9,32],[8,40],[7,46],[6,51],[5,56],[4,61],[3,66],[2,70],[1,85] ],
    '一分钟仰卧起坐': [ [10,50],[9,46],[8,42],[7,38],[6,34],[5,30],[4,26],[3,22],[2,18],[1,14] ],
    '游泳': [ [10,100],[9,90],[8,80],[7,70],[6,60],[5,50],[4,40],[3,30],[2,25],[1,0] ],
  };

  var MALE_STANDARDS = {
    '1000米跑': [ [10,220],[9,230],[8,240],[7,250],[6,260],[5,270],[4,280],[3,290],[2,300],[1,310] ],
    '足球运球': [ [10,9.1],[9,10.0],[8,10.7],[7,11.5],[6,12.8],[5,13.6],[4,14.6],[3,15.2],[2,15.9],[1,16.8] ],
    '50米跑': [ [10,7.1],[9,7.3],[8,7.5],[7,7.7],[6,7.9],[5,8.1],[4,8.3],[3,8.7],[2,9.3],[1,9.7] ],
    '立定跳远': [ [10,2.46],[9,2.38],[8,2.30],[7,2.22],[6,2.14],[5,2.06],[4,1.98],[3,1.90],[2,1.82],[1,1.70] ],
    '一分钟跳绳': [ [10,180],[9,170],[8,160],[7,150],[6,140],[5,130],[4,120],[3,110],[2,100],[1,90] ],
    '掷实心球': [ [10,9.80],[9,9.20],[8,8.60],[7,8.00],[6,7.40],[5,6.80],[4,6.20],[3,5.60],[2,5.00],[1,4.40] ],
    '篮球运球投篮': [ [10,20],[9,24],[8,32],[7,38],[6,43],[5,48],[4,53],[3,57],[2,61],[1,69] ],
    '引体向上': [ [10,10],[9,9],[8,8],[7,7],[6,6],[5,5],[4,4],[3,3],[2,2],[1,1] ],
    '游泳': [ [10,100],[9,90],[8,80],[7,70],[6,60],[5,50],[4,40],[3,30],[2,25],[1,0] ],
  };

  async function initDefaultData() {
    var existingProjects = await sbFind('Project', {});
    var projectMap = {};
    if (existingProjects.length === 0) {
      for (var i = 0; i < DEFAULT_PROJECTS.length; i++) {
        var obj = await sbCreate('Project', DEFAULT_PROJECTS[i]);
        projectMap[obj.name] = obj;
      }
    } else {
      for (var j = 0; j < existingProjects.length; j++) {
        projectMap[existingProjects[j].name] = existingProjects[j];
      }
      for (var k = 0; k < DEFAULT_PROJECTS.length; k++) {
        var p = DEFAULT_PROJECTS[k];
        if (!projectMap[p.name]) {
          var obj = await sbCreate('Project', p);
          projectMap[p.name] = obj;
        }
      }
    }

    var existingStandards = await sbFind('ScoreStandard', {});
    if (existingStandards.length === 0) {
      var genders = [
        { key: '女', data: FEMALE_STANDARDS },
        { key: '男', data: MALE_STANDARDS },
      ];
      for (var gi = 0; gi < genders.length; gi++) {
        var g = genders[gi];
        var projNames = Object.keys(g.data);
        for (var pi = 0; pi < projNames.length; pi++) {
          var projName = projNames[pi];
          var proj = projectMap[projName];
          if (!proj) continue;
          var standards = g.data[projName];
          for (var si = 0; si < standards.length; si++) {
            await sbCreate('ScoreStandard', {
              project_id: proj.id,
              gender: g.key,
              score: standards[si][0],
              threshold_value: standards[si][1],
            });
          }
        }
      }
    }

    var pwdCfg = await sbFind('AppConfig', { key: 'teacherPassword' });
    if (pwdCfg.length === 0) {
      await sbCreate('AppConfig', { key: 'teacherPassword', value: 'teacher123' });
    }

    return projectMap;
  }

  // ==================== 教师口令 ====================

  async function verifyTeacherPassword(inputPwd) {
    var cfg = await sbFind('AppConfig', { key: 'teacherPassword' });
    if (cfg.length === 0) return false;
    return cfg[0].value === inputPwd;
  }

  async function updateTeacherPassword(newPwd) {
    var cfg = await sbFind('AppConfig', { key: 'teacherPassword' });
    if (cfg.length === 0) {
      await sbCreate('AppConfig', { key: 'teacherPassword', value: newPwd });
    } else {
      await sbUpdate('AppConfig', cfg[0].id, { value: newPwd });
    }
  }

  // ==================== 语音输入解析 ====================

  var CN_NUM_MAP = {
    '零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'百':100,
  };

  function cnNumToInt(text) {
    var result = 0, temp = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (CN_NUM_MAP[ch] !== undefined) {
        var v = CN_NUM_MAP[ch];
        if (v === 10) { if (temp === 0) temp = 1; temp *= 10; result += temp; temp = 0; }
        else if (v === 100) { if (temp === 0) temp = 1; temp *= 100; result += temp; temp = 0; }
        else { temp = v; }
      }
    }
    result += temp;
    return result;
  }

  function speechToScore(rawText) {
    var text = rawText.replace(/[，。！？、\s]/g, '').trim();
    if (!text) return '';

    var timeMatch = text.match(/^(.+)分(.+)秒$/);
    if (timeMatch) {
      var min = cnNumToInt(timeMatch[1]);
      var sec = cnNumToInt(timeMatch[2].replace(/零/g, ''));
      var secStr = sec.toString();
      if (sec < 10 && timeMatch[2].indexOf('零') === -1 && timeMatch[2].length === 1) {
        secStr = (sec * 10).toString();
      }
      return min + "'" + secStr.padStart(2, '0') + '"';
    }

    var secMatch = text.match(/^(.+)秒(.+)$/);
    if (secMatch) {
      var baseSec = cnNumToInt(secMatch[1]);
      var frac = cnNumToInt(secMatch[2].replace(/零/g, ''));
      var fracStr = frac.toString();
      if (frac < 10 && secMatch[2].length === 1) fracStr = (frac * 10).toString();
      return (baseSec + parseFloat('0.' + fracStr)).toString();
    }

    var meterMatch = text.match(/^(.+)米(.+)$/);
    if (meterMatch) {
      return cnNumToInt(meterMatch[1]) + '.' + cnNumToInt(meterMatch[2].replace(/零/g, '')).toString().padStart(2, '0');
    }

    var numMatch = text.match(/^([零一二两三四五六七八九十百]+)[个次米秒]?$/);
    if (numMatch) return cnNumToInt(numMatch[1]).toString();

    if (/^[\d.]+$/.test(text)) return text;
    return text;
  }

  // ==================== 导出 ====================

  window.SportsUtils = {
    timeToSeconds: timeToSeconds,
    secondsToTime: secondsToTime,
    sbFind: sbFind,
    sbGet: sbGet,
    sbCreate: sbCreate,
    sbUpdate: sbUpdate,
    sbDelete: sbDelete,
    getScoreStandards: getScoreStandards,
    calculateScore: calculateScore,
    generateTrainingAdvice: generateTrainingAdvice,
    initDefaultData: initDefaultData,
    verifyTeacherPassword: verifyTeacherPassword,
    updateTeacherPassword: updateTeacherPassword,
    speechToScore: speechToScore,
    DEFAULT_PROJECTS: DEFAULT_PROJECTS,
  };
})();
