(() => {
  "use strict";

  const STORAGE_KEY = "karamozi-drug-timing-game:v1";
  const TOPIC_KEY = "karamozi-drug-timing-game:topic";
  const TIMING_DRUGS = Array.isArray(window.DRUGS_DATA)
    ? window.DRUGS_DATA.filter((drug) => drug.name && drug.consumptionTimeSorted)
    : [];
  const TOPIC_DRUGS = Array.isArray(window.DRUG_TOPIC_DATA)
    ? window.DRUG_TOPIC_DATA.filter((drug) => drug.brandName && drug.genericName)
    : [];
  const TOPICS = {
    timing: {
      id: "timing",
      label: "با غذا / بی غذا",
      detail: "زمان مصرف دارو نسبت به غذا",
      data: TIMING_DRUGS,
      getAnswer: (drug) => drug.consumptionTimeSorted,
      getName: (drug) => drug.name,
      getSubtitle: (drug) => drug.pname || "",
      getChip: (drug) => drug.dosageForm || "فرم دارویی ثبت نشده",
      getQuestionHtml: (drug) =>
        `داروی <span class="drug-name">${escapeHtml(drug.name)}</span> چه زمانی نسبت به غذا مصرف می‌شود؟`,
      getSubtitleText: (drug) => (drug.pname ? `نام فارسی: ${drug.pname}` : ""),
      getFeedback: (drug) => drug.consumptionTime || `پاسخ صحیح: ${drug.consumptionTimeSorted}`,
    },
    brandGeneric: {
      id: "brandGeneric",
      label: "نام تجاری / ژنریک",
      detail: "تطبیق Brand name با Generic name",
      data: TOPIC_DRUGS.filter((drug) => drug.genericName),
      getAnswer: (drug) => drug.genericName,
      getName: (drug) => drug.brandName,
      getSubtitle: (drug) => drug.drugClassification || drug.dosageForm || "",
      getChip: (drug) => drug.drugClassification || "نام تجاری دارو",
      getQuestionHtml: (drug) =>
        `نام ژنریک داروی تجاری <span class="drug-name">${escapeHtml(drug.brandName)}</span> کدام است؟`,
      getSubtitleText: (drug) => (drug.dosageForm ? `فرم دارویی: ${drug.dosageForm}` : ""),
      getFeedback: (drug) =>
        `${drug.brandName} = ${drug.genericName}${drug.drugClassification ? ` | ${drug.drugClassification}` : ""}`,
    },
    indication: {
      id: "indication",
      label: "اندیکاسیون",
      detail: "کاربرد یا مورد مصرف دارو",
      data: TOPIC_DRUGS.filter((drug) => drug.indicationAnswer),
      getAnswer: (drug) => drug.indicationAnswer,
      getName: (drug) => drug.brandName,
      getSubtitle: (drug) => drug.genericName,
      getChip: (drug) => drug.dosageForm || "فرم دارویی ثبت نشده",
      getQuestionHtml: (drug) =>
        `کاربرد اصلی داروی <span class="drug-name">${escapeHtml(drug.brandName)}</span> کدام است؟`,
      getSubtitleText: (drug) => `نام ژنریک: ${drug.genericName}`,
      getFeedback: (drug) => `کاربرد: ${drug.indication}`,
    },
    sideEffects: {
      id: "sideEffects",
      label: "عوارض جانبی",
      detail: "Side effects مهم دارو",
      data: TOPIC_DRUGS.filter((drug) => drug.sideEffectsAnswer),
      getAnswer: (drug) => drug.sideEffectsAnswer,
      getName: (drug) => drug.brandName,
      getSubtitle: (drug) => drug.genericName,
      getChip: (drug) => drug.dosageForm || "فرم دارویی ثبت نشده",
      getQuestionHtml: (drug) =>
        `کدام مورد از عوارض جانبی مهم داروی <span class="drug-name">${escapeHtml(drug.brandName)}</span> است؟`,
      getSubtitleText: (drug) => `نام ژنریک: ${drug.genericName}`,
      getFeedback: (drug) => `عوارض مهم: ${drug.sideEffects}`,
    },
  };
  const TOPIC_IDS = Object.keys(TOPICS);
  const topicDrugMaps = Object.fromEntries(
    TOPIC_IDS.map((topicId) => [
      topicId,
      new Map(TOPICS[topicId].data.map((drug) => [drug.id, drug])),
    ])
  );
  const optionPools = Object.fromEntries(
    TOPIC_IDS.map((topicId) => [
      topicId,
      [...new Set(TOPICS[topicId].data.map((drug) => TOPICS[topicId].getAnswer(drug)).filter(Boolean))],
    ])
  );
  const numberFormatter = new Intl.NumberFormat("en-US");
  const faDate = new Intl.DateTimeFormat("fa-IR-u-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let selectedTopicId = loadSelectedTopic();
  let store = loadStore();
  let quiz = null;

  const elements = {
    views: [...document.querySelectorAll(".view")],
    navButtons: [...document.querySelectorAll("[data-nav]")],
    topicRadios: [...document.querySelectorAll("input[name='question-topic']")],
    modeRadios: [...document.querySelectorAll("input[name='game-mode']")],
    randomCount: document.querySelector("#random-count"),
    feedback: document.querySelector("[data-feedback]"),
    feedbackStatus: document.querySelector("[data-feedback-status]"),
    feedbackNote: document.querySelector("[data-feedback-note]"),
    nextQuestion: document.querySelector("[data-next-question]"),
    options: document.querySelector("[data-options]"),
    questionText: document.querySelector("[data-question-text]"),
    questionSubtitle: document.querySelector("[data-question-subtitle]"),
    dosageForm: document.querySelector("[data-dosage-form]"),
    progress: document.querySelector("[data-current-progress]"),
    score: document.querySelector("[data-current-score]"),
    correct: document.querySelector("[data-current-correct]"),
    streak: document.querySelector("[data-current-streak]"),
    progressBar: document.querySelector("[data-progress-bar]"),
    gameModeLabel: document.querySelector("[data-game-mode-label]"),
    recentGames: document.querySelector("[data-recent-games]"),
    topMistakes: document.querySelector("[data-top-mistakes]"),
    mistakeBoard: document.querySelector("[data-mistake-board]"),
    scoreBoard: document.querySelector("[data-score-board]"),
  };

  init();

  function init() {
    elements.randomCount.value = "20";
    document.documentElement.dataset.theme = "light";

    elements.navButtons.forEach((button) => {
      button.addEventListener("click", () => navigate(button.dataset.nav));
    });

    elements.topicRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        selectedTopicId = getTopic(radio.value).id;
        saveSelectedTopic();
        updateTopicSelection();
        renderDashboard();
        if (!quiz) renderIdleGame();
        if (document.querySelector("#mistakes").classList.contains("is-active")) renderMistakes();
        if (document.querySelector("#scores").classList.contains("is-active")) renderScores();
      });
    });

    elements.modeRadios.forEach((radio) => {
      radio.addEventListener("change", updateModeSelection);
    });

    document.querySelector("[data-start-selected]").addEventListener("click", startSelectedMode);
    document.querySelector("[data-start-random]").addEventListener("click", () => startRandomGame());
    document.querySelector("[data-start-all]").addEventListener("click", startAllGame);
    document.querySelector("[data-end-game]").addEventListener("click", endGameFromButton);
    document.querySelector("[data-reset-scores]").addEventListener("click", resetScores);
    document.querySelector("[data-reset-mistakes]").addEventListener("click", resetMistakes);
    document.querySelector("[data-practice-mistakes]").addEventListener("click", startMistakePractice);
    document.querySelector("[data-export-report]").addEventListener("click", exportReport);
    elements.nextQuestion.addEventListener("click", nextQuestion);

    updateTopicSelection();
    updateModeSelection();
    renderDashboard();
    renderIdleGame();
    registerServiceWorker();
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return makeEmptyStore();
      const parsed = JSON.parse(raw);
      const nextStore = makeEmptyStore();

      if (parsed.topics && typeof parsed.topics === "object") {
        TOPIC_IDS.forEach((topicId) => {
          nextStore.topics[topicId] = normalizeTopicStore(parsed.topics[topicId]);
        });
        return nextStore;
      }

      nextStore.topics.timing = normalizeTopicStore(parsed);
      return nextStore;
    } catch {
      return makeEmptyStore();
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Browsers may block localStorage in strict private modes; the game keeps running in memory.
    }
  }

  function makeEmptyStore() {
    return {
      topics: Object.fromEntries(TOPIC_IDS.map((topicId) => [topicId, makeEmptyTopicStore()])),
    };
  }

  function makeEmptyTopicStore() {
    return {
      games: [],
      mistakes: {},
      totals: {
        answered: 0,
        correct: 0,
      },
    };
  }

  function normalizeTopicStore(topicStore) {
    if (!topicStore || typeof topicStore !== "object") return makeEmptyTopicStore();
    return {
      games: Array.isArray(topicStore.games) ? topicStore.games : [],
      mistakes:
        topicStore.mistakes && typeof topicStore.mistakes === "object"
          ? topicStore.mistakes
          : {},
      totals: {
        answered: Number(topicStore.totals?.answered || 0),
        correct: Number(topicStore.totals?.correct || 0),
      },
    };
  }

  function loadSelectedTopic() {
    try {
      const saved = localStorage.getItem(TOPIC_KEY);
      return TOPICS[saved] ? saved : "timing";
    } catch {
      return "timing";
    }
  }

  function saveSelectedTopic() {
    try {
      localStorage.setItem(TOPIC_KEY, selectedTopicId);
    } catch {
      // Topic selection still applies for the active page when storage is blocked.
    }
  }

  function navigate(viewId) {
    elements.views.forEach((view) => view.classList.toggle("is-active", view.id === viewId));
    elements.navButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.nav === viewId);
    });

    if (viewId === "mistakes") renderMistakes();
    if (viewId === "scores") renderScores();
    if (viewId === "dashboard") renderDashboard();
    if (viewId === "game" && !quiz) renderIdleGame();
  }

  function updateTopicSelection() {
    elements.topicRadios.forEach((radio) => {
      const isSelected = radio.value === selectedTopicId;
      radio.checked = isSelected;
      radio.closest(".topic-option").classList.toggle("is-selected", isSelected);
    });
  }

  function updateModeSelection() {
    elements.modeRadios.forEach((radio) => {
      radio.closest(".mode-option").classList.toggle("is-selected", radio.checked);
    });
  }

  function startSelectedMode() {
    const selected = elements.modeRadios.find((radio) => radio.checked)?.value || "random";
    if (selected === "all") {
      startAllGame();
      return;
    }
    startRandomGame();
  }

  function startRandomGame() {
    const topic = getActiveTopic();
    if (!topic.data.length) return;
    const count = normalizeRandomCount(elements.randomCount.value, topic.data.length);
    elements.randomCount.value = String(count);
    const questions = shuffle(topic.data).slice(0, count);
    beginQuiz(questions, `${topic.label} | تصادفی`, "random", topic.id);
  }

  function startAllGame() {
    const topic = getActiveTopic();
    if (!topic.data.length) return;
    beginQuiz([...topic.data], `${topic.label} | همه سؤال‌ها`, "all", topic.id);
  }

  function startMistakePractice() {
    const topic = getActiveTopic();
    const mistakes = getMistakeItems(topic.id);
    if (!mistakes.length) {
      navigate("mistakes");
      return;
    }

    const questions = mistakes
      .map((item) => topicDrugMaps[topic.id].get(item.drugId))
      .filter(Boolean);
    beginQuiz(questions, `${topic.label} | تمرین خطاها`, "mistakes", topic.id);
  }

  function beginQuiz(questions, label, mode, topicId) {
    quiz = {
      questions,
      label,
      mode,
      topicId,
      index: 0,
      score: 0,
      correct: 0,
      streak: 0,
      answers: [],
      saved: false,
      startedAt: Date.now(),
      currentAnswered: false,
    };

    renderQuestion();
    navigate("game");
  }

  function renderIdleGame() {
    const topic = getActiveTopic();
    elements.gameModeLabel.textContent = topic.label;
    elements.progress.textContent = "0/0";
    elements.score.textContent = "0";
    elements.correct.textContent = "0";
    elements.streak.textContent = "0";
    elements.progressBar.style.width = "0%";
    elements.dosageForm.textContent = "آماده شروع";
    elements.questionText.textContent = "یک موضوع و مدل بازی از داشبورد انتخاب کنید.";
    elements.questionSubtitle.textContent = topic.detail;
    clearChildren(elements.options);
    elements.feedback.hidden = true;

    const randomButton = makeActionButton("شروع تصادفی", "primary-action", startRandomGame);
    const allButton = makeActionButton("کل سؤال‌های موضوع", "secondary-action", startAllGame);
    elements.options.append(randomButton, allButton);
  }

  function renderQuestion() {
    if (!quiz || quiz.index >= quiz.questions.length) {
      finishGame();
      return;
    }

    const topic = getTopic(quiz.topicId);
    const drug = quiz.questions[quiz.index];
    quiz.currentAnswered = false;
    elements.gameModeLabel.textContent = quiz.label;
    elements.progress.textContent = `${formatNumber(quiz.index + 1)}/${formatNumber(quiz.questions.length)}`;
    elements.score.textContent = formatNumber(quiz.score);
    elements.correct.textContent = formatNumber(quiz.correct);
    elements.streak.textContent = formatNumber(quiz.streak);
    elements.progressBar.style.width = `${Math.round((quiz.index / quiz.questions.length) * 100)}%`;
    elements.dosageForm.textContent = topic.getChip(drug);
    elements.questionText.innerHTML = topic.getQuestionHtml(drug);
    elements.questionSubtitle.textContent = topic.getSubtitleText(drug);
    elements.feedback.hidden = true;
    clearChildren(elements.options);

    buildOptions(drug, topic).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-button";
      button.textContent = option;
      button.addEventListener("click", () => answerQuestion(option, button));
      elements.options.append(button);
    });
  }

  function answerQuestion(selected, button) {
    if (!quiz || quiz.currentAnswered) return;

    const topic = getTopic(quiz.topicId);
    const drug = quiz.questions[quiz.index];
    const correctAnswer = topic.getAnswer(drug);
    const isCorrect = selected === correctAnswer;
    quiz.currentAnswered = true;

    [...elements.options.querySelectorAll(".option-button")].forEach((optionButton) => {
      optionButton.disabled = true;
      if (optionButton.textContent === correctAnswer) optionButton.classList.add("is-correct");
    });

    if (isCorrect) {
      const streakBonus = Math.min(quiz.streak, 5) * 2;
      quiz.streak += 1;
      quiz.correct += 1;
      quiz.score += 10 + streakBonus;
      elements.feedbackStatus.textContent = `درست +${formatNumber(10 + streakBonus)}`;
      elements.feedbackStatus.className = "feedback-status correct";
    } else {
      quiz.streak = 0;
      button.classList.add("is-wrong");
      recordMistake(topic, drug, selected);
      elements.feedbackStatus.textContent = "اشتباه";
      elements.feedbackStatus.className = "feedback-status wrong";
    }

    quiz.answers.push({
      drugId: drug.id,
      topicId: topic.id,
      selected,
      correctAnswer,
      isCorrect,
    });

    const topicStore = getTopicStore(topic.id);
    topicStore.totals.answered += 1;
    if (isCorrect) topicStore.totals.correct += 1;
    saveStore();

    elements.score.textContent = formatNumber(quiz.score);
    elements.correct.textContent = formatNumber(quiz.correct);
    elements.streak.textContent = formatNumber(quiz.streak);
    elements.progressBar.style.width = `${Math.round(((quiz.index + 1) / quiz.questions.length) * 100)}%`;
    elements.feedbackNote.textContent = topic.getFeedback(drug);
    elements.nextQuestion.textContent =
      quiz.index + 1 >= quiz.questions.length ? "مشاهده نتیجه" : "سؤال بعدی";
    elements.feedback.hidden = false;
  }

  function nextQuestion() {
    if (!quiz) return;
    if (quiz.index + 1 >= quiz.questions.length) {
      finishGame();
      return;
    }
    quiz.index += 1;
    renderQuestion();
  }

  function endGameFromButton() {
    if (!quiz) {
      navigate("dashboard");
      return;
    }

    if (quiz.answers.length && quiz.answers.length < quiz.questions.length) {
      const shouldEnd = window.confirm("بازی فعلی پایان داده شود و امتیازهای پاسخ‌داده‌شده ذخیره شوند؟");
      if (!shouldEnd) return;
    }

    finishGame();
  }

  function finishGame() {
    if (!quiz) return;

    const topic = getTopic(quiz.topicId);
    const topicStore = getTopicStore(topic.id);
    const answered = quiz.answers.length;
    const wrong = answered - quiz.correct;
    const percent = answered ? Math.round((quiz.correct / answered) * 100) : 0;
    const record = {
      id: makeId(),
      topicId: topic.id,
      topicLabel: topic.label,
      mode: quiz.mode,
      label: quiz.label,
      total: quiz.questions.length,
      answered,
      correct: quiz.correct,
      wrong,
      score: quiz.score,
      percent,
      endedAt: new Date().toISOString(),
      durationSeconds: Math.max(1, Math.round((Date.now() - quiz.startedAt) / 1000)),
    };

    if (!quiz.saved && answered > 0) {
      topicStore.games.unshift(record);
      topicStore.games = topicStore.games.slice(0, 60);
      quiz.saved = true;
      saveStore();
    }

    elements.gameModeLabel.textContent = "نتیجه";
    elements.progress.textContent = `${formatNumber(answered)}/${formatNumber(quiz.questions.length)}`;
    elements.score.textContent = formatNumber(quiz.score);
    elements.correct.textContent = formatNumber(quiz.correct);
    elements.streak.textContent = formatNumber(quiz.streak);
    elements.progressBar.style.width = "100%";
    elements.dosageForm.textContent = "پایان بازی";
    elements.questionText.textContent = "نتیجه بازی";
    elements.questionSubtitle.textContent = `${formatNumber(quiz.correct)} پاسخ درست، ${formatNumber(wrong)} پاسخ اشتباه، دقت ${formatNumber(percent)}٪`;
    elements.feedback.hidden = true;
    clearChildren(elements.options);

    elements.options.append(
      makeSummaryTile("امتیاز", formatNumber(quiz.score)),
      makeSummaryTile("سؤال پاسخ‌داده‌شده", formatNumber(answered)),
      makeSummaryTile("دقت", `${formatNumber(percent)}٪`),
      makeSummaryTile("زمان", `${formatNumber(record.durationSeconds)} ثانیه`),
      makeActionButton("بازی تصادفی جدید", "primary-action", startRandomGame),
      makeActionButton("دیدن خطاها", "secondary-action", () => navigate("mistakes"))
    );

    renderDashboard();
    renderMistakes();
    renderScores();
    quiz = null;
  }

  function buildOptions(drug, topic) {
    const correctAnswer = topic.getAnswer(drug);
    const distractors = shuffle(optionPools[topic.id].filter((option) => option !== correctAnswer)).slice(0, 3);
    return shuffle([correctAnswer, ...distractors]).slice(0, 4);
  }

  function recordMistake(topic, drug, selected) {
    const topicStore = getTopicStore(topic.id);
    const previous = topicStore.mistakes[drug.id] || {
      drugId: drug.id,
      topicId: topic.id,
      name: topic.getName(drug),
      subtitle: topic.getSubtitle(drug),
      correctAnswer: topic.getAnswer(drug),
      feedback: topic.getFeedback(drug),
      wrongCount: 0,
      lastWrongAnswer: "",
      lastAt: "",
    };

    topicStore.mistakes[drug.id] = {
      ...previous,
      topicId: topic.id,
      name: topic.getName(drug),
      subtitle: topic.getSubtitle(drug),
      correctAnswer: topic.getAnswer(drug),
      feedback: topic.getFeedback(drug),
      wrongCount: previous.wrongCount + 1,
      lastWrongAnswer: selected,
      lastAt: new Date().toISOString(),
    };
  }

  function renderDashboard() {
    const topic = getActiveTopic();
    const topicStore = getTopicStore(topic.id);
    const bestScore = topicStore.games.reduce((best, game) => Math.max(best, game.score || 0), 0);
    const accuracy = topicStore.totals.answered
      ? Math.round((topicStore.totals.correct / topicStore.totals.answered) * 100)
      : 0;

    setMetric("totalDrugs", formatNumber(topic.data.length));
    setMetric("bestScore", formatNumber(bestScore));
    setMetric("accuracy", `${formatNumber(accuracy)}٪`);
    setMetric("mistakeCount", formatNumber(getMistakeItems(topic.id).length));

    renderRecentGames();
    renderTopMistakes();
  }

  function renderRecentGames() {
    clearChildren(elements.recentGames);
    const topic = getActiveTopic();
    const games = getTopicStore(topic.id).games.slice(0, 5);

    if (!games.length) {
      elements.recentGames.append(emptyState(`هنوز امتیازی برای ${topic.label} ذخیره نشده است.`));
      return;
    }

    games.forEach((game) => {
      const row = document.createElement("div");
      row.className = "mini-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = game.label;
      const detail = document.createElement("small");
      detail.textContent = `${formatNumber(game.correct)}/${formatNumber(game.answered)} درست | ${formatDate(game.endedAt)}`;
      copy.append(title, detail);
      const score = document.createElement("span");
      score.className = "pill-count";
      score.textContent = formatNumber(game.score);
      row.append(copy, score);
      elements.recentGames.append(row);
    });
  }

  function renderTopMistakes() {
    clearChildren(elements.topMistakes);
    const topic = getActiveTopic();
    const mistakes = getMistakeItems(topic.id).slice(0, 5);

    if (!mistakes.length) {
      elements.topMistakes.append(emptyState(`بانک خطاهای ${topic.label} خالی است.`));
      return;
    }

    mistakes.forEach((mistake) => {
      const row = document.createElement("div");
      row.className = "mini-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${mistake.name} ${mistake.subtitle ? `- ${mistake.subtitle}` : ""}`;
      const detail = document.createElement("small");
      detail.textContent = `پاسخ صحیح: ${mistake.correctAnswer}`;
      copy.append(title, detail);
      const count = document.createElement("span");
      count.className = "pill-count";
      count.textContent = formatNumber(mistake.wrongCount);
      row.append(copy, count);
      elements.topMistakes.append(row);
    });
  }

  function renderMistakes() {
    clearChildren(elements.mistakeBoard);
    const topic = getActiveTopic();
    const mistakes = getMistakeItems(topic.id);

    if (!mistakes.length) {
      elements.mistakeBoard.append(emptyState(`هنوز پاسخ اشتباهی برای ${topic.label} ثبت نشده است.`));
      return;
    }

    mistakes.forEach((mistake) => {
      const drug = topicDrugMaps[topic.id].get(mistake.drugId);
      const row = document.createElement("article");
      row.className = "mistake-row";

      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = `${mistake.name}${mistake.subtitle ? ` | ${mistake.subtitle}` : ""}`;
      const description = document.createElement("p");
      description.textContent = drug ? topic.getFeedback(drug) : mistake.feedback || `پاسخ صحیح: ${mistake.correctAnswer}`;

      const tags = document.createElement("div");
      tags.className = "meta-tags";
      tags.append(
        makeTag(`صحیح: ${mistake.correctAnswer}`, "correct"),
        makeTag(`آخرین پاسخ: ${mistake.lastWrongAnswer}`, "wrong"),
        makeTag(formatDate(mistake.lastAt), "")
      );

      copy.append(title, description, tags);

      const stat = document.createElement("div");
      stat.className = "row-stat";
      stat.append(document.createTextNode(formatNumber(mistake.wrongCount)));
      const small = document.createElement("small");
      small.textContent = "خطا";
      stat.append(small);
      row.append(copy, stat);
      elements.mistakeBoard.append(row);
    });
  }

  function renderScores() {
    clearChildren(elements.scoreBoard);
    const topic = getActiveTopic();
    const games = getTopicStore(topic.id).games;

    if (!games.length) {
      elements.scoreBoard.append(emptyState(`هنوز بازی برای ${topic.label} ثبت نشده است.`));
      return;
    }

    games.forEach((game) => {
      const row = document.createElement("article");
      row.className = "score-row";

      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = game.label;
      const description = document.createElement("p");
      description.textContent = `${formatDate(game.endedAt)} | ${formatNumber(game.durationSeconds)} ثانیه`;
      const tags = document.createElement("div");
      tags.className = "meta-tags";
      tags.append(
        makeTag(game.topicLabel || topic.label, ""),
        makeTag(`${formatNumber(game.correct)}/${formatNumber(game.answered)} درست`, "correct"),
        makeTag(`${formatNumber(game.wrong)} اشتباه`, game.wrong ? "wrong" : "correct"),
        makeTag(`${formatNumber(game.percent)}٪ دقت`, "")
      );
      copy.append(title, description, tags);

      const stat = document.createElement("div");
      stat.className = "row-stat";
      stat.append(document.createTextNode(formatNumber(game.score)));
      const small = document.createElement("small");
      small.textContent = "امتیاز";
      stat.append(small);
      row.append(copy, stat);
      elements.scoreBoard.append(row);
    });
  }

  function resetScores() {
    const topic = getActiveTopic();
    const topicStore = getTopicStore(topic.id);
    if (!topicStore.games.length && !topicStore.totals.answered) return;
    const accepted = window.confirm(`همه‌ی امتیازهای ذخیره‌شده برای ${topic.label} پاک شوند؟`);
    if (!accepted) return;
    topicStore.games = [];
    topicStore.totals = { answered: 0, correct: 0 };
    saveStore();
    renderDashboard();
    renderScores();
  }

  function resetMistakes() {
    const topic = getActiveTopic();
    if (!getMistakeItems(topic.id).length) return;
    const accepted = window.confirm(`همه‌ی خطاهای ذخیره‌شده برای ${topic.label} پاک شوند؟`);
    if (!accepted) return;
    getTopicStore(topic.id).mistakes = {};
    saveStore();
    renderDashboard();
    renderMistakes();
  }

  function exportReport() {
    const report = {
      exportedAt: new Date().toISOString(),
      activeTopic: selectedTopicId,
      topics: Object.fromEntries(
        TOPIC_IDS.map((topicId) => [
          topicId,
          {
            label: TOPICS[topicId].label,
            totalDrugs: TOPICS[topicId].data.length,
            scores: getTopicStore(topicId).games,
            mistakes: getMistakeItems(topicId),
            totals: getTopicStore(topicId).totals,
          },
        ])
      ),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "karamozi-drug-game-report.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function getMistakeItems(topicId = selectedTopicId) {
    return Object.values(getTopicStore(topicId).mistakes)
      .filter((item) => item && item.drugId)
      .sort((a, b) => {
        if ((b.wrongCount || 0) !== (a.wrongCount || 0)) {
          return (b.wrongCount || 0) - (a.wrongCount || 0);
        }
        return String(b.lastAt || "").localeCompare(String(a.lastAt || ""));
      });
  }

  function getActiveTopic() {
    return getTopic(selectedTopicId);
  }

  function getTopic(topicId) {
    return TOPICS[topicId] || TOPICS.timing;
  }

  function getTopicStore(topicId = selectedTopicId) {
    const safeTopicId = getTopic(topicId).id;
    if (!store.topics[safeTopicId]) store.topics[safeTopicId] = makeEmptyTopicStore();
    return store.topics[safeTopicId];
  }

  function makeSummaryTile(label, value) {
    const tile = document.createElement("div");
    tile.className = "summary-tile";
    const span = document.createElement("span");
    span.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    tile.append(span, strong);
    return tile;
  }

  function makeActionButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function makeTag(text, variant) {
    const tag = document.createElement("span");
    tag.className = variant ? `tag ${variant}` : "tag";
    tag.textContent = text;
    return tag;
  }

  function emptyState(text) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = text;
    return div;
  }

  function setMetric(name, value) {
    const element = document.querySelector(`[data-metric="${name}"]`);
    if (element) element.textContent = value;
  }

  function clearChildren(node) {
    while (node.firstChild) node.firstChild.remove();
  }

  function shuffle(items) {
    const output = [...items];
    for (let index = output.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [output[index], output[target]] = [output[target], output[index]];
    }
    return output;
  }

  function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  function normalizeRandomCount(value, maxCount) {
    const raw = Number(value || 20);
    const rounded = Math.round(raw / 10) * 10;
    return clamp(rounded, 10, Math.min(100, maxCount || 10));
  }

  function formatNumber(value) {
    return numberFormatter.format(Number(value || 0));
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "ثبت نشده";
    return faDate.format(date);
  }

  function makeId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return;

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {
        // The game still works online if a browser blocks service worker registration.
      });
    });
  }
})();
