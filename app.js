(() => {
  "use strict";

  const STORAGE_KEY = "karamozi-drug-timing-game:v1";
  const THEME_KEY = "karamozi-drug-timing-game:theme";
  const DRUGS = Array.isArray(window.DRUGS_DATA)
    ? window.DRUGS_DATA.filter((drug) => drug.name && drug.consumptionTimeSorted)
    : [];
  const OPTION_POOL = [...new Set(DRUGS.map((drug) => drug.consumptionTimeSorted).filter(Boolean))];
  const drugById = new Map(DRUGS.map((drug) => [drug.id, drug]));
  const numberFormatter = new Intl.NumberFormat("en-US");
  const faDate = new Intl.DateTimeFormat("fa-IR-u-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const fallbackStore = {
    games: [],
    mistakes: {},
    totals: {
      answered: 0,
      correct: 0,
    },
  };

  let store = loadStore();
  let quiz = null;

  const elements = {
    views: [...document.querySelectorAll(".view")],
    navButtons: [...document.querySelectorAll("[data-nav]")],
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
    themeRadios: [...document.querySelectorAll("input[name='theme-mode']")],
  };

  init();

  function init() {
    elements.randomCount.value = "20";
    applyTheme(loadTheme(), false);

    elements.navButtons.forEach((button) => {
      button.addEventListener("click", () => navigate(button.dataset.nav));
    });

    elements.modeRadios.forEach((radio) => {
      radio.addEventListener("change", updateModeSelection);
    });

    elements.themeRadios.forEach((radio) => {
      radio.addEventListener("change", () => applyTheme(radio.value));
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

    updateModeSelection();
    renderDashboard();
    renderIdleGame();
    registerServiceWorker();
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneSafe(fallbackStore);
      const parsed = JSON.parse(raw);
      return {
        games: Array.isArray(parsed.games) ? parsed.games : [],
        mistakes: parsed.mistakes && typeof parsed.mistakes === "object" ? parsed.mistakes : {},
        totals: {
          answered: Number(parsed.totals?.answered || 0),
          correct: Number(parsed.totals?.correct || 0),
        },
      };
    } catch {
      return structuredCloneSafe(fallbackStore);
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Browsers may block localStorage in strict private modes; the game keeps running in memory.
    }
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadTheme() {
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    if (["light", "dark"].includes(requestedTheme)) return requestedTheme;

    try {
      const saved = localStorage.getItem(THEME_KEY);
      return ["light", "dark"].includes(saved) ? saved : "light";
    } catch {
      return "light";
    }
  }

  function applyTheme(theme, shouldSave = true) {
    const selectedTheme = ["light", "dark"].includes(theme) ? theme : "light";
    document.documentElement.dataset.theme = selectedTheme;

    elements.themeRadios.forEach((radio) => {
      const isSelected = radio.value === selectedTheme;
      radio.checked = isSelected;
      radio.closest(".theme-option").classList.toggle("is-selected", isSelected);
    });

    if (!shouldSave) return;
    try {
      localStorage.setItem(THEME_KEY, selectedTheme);
    } catch {
      // Theme changes still apply for the active page when persistent storage is blocked.
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
    if (!DRUGS.length) return;
    const count = normalizeRandomCount(elements.randomCount.value);
    elements.randomCount.value = String(count);
    const questions = shuffle(DRUGS).slice(0, count);
    beginQuiz(questions, "تصادفی", "random");
  }

  function startAllGame() {
    if (!DRUGS.length) return;
    beginQuiz([...DRUGS], "همه ی داروها", "all");
  }

  function startMistakePractice() {
    const mistakes = getMistakeItems();
    if (!mistakes.length) {
      navigate("mistakes");
      return;
    }

    const questions = mistakes
      .map((item) => drugById.get(item.drugId))
      .filter(Boolean);
    beginQuiz(questions, "تمرین خطاها", "mistakes");
  }

  function beginQuiz(questions, label, mode) {
    quiz = {
      questions,
      label,
      mode,
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
    elements.gameModeLabel.textContent = "بازی";
    elements.progress.textContent = "0/0";
    elements.score.textContent = "0";
    elements.correct.textContent = "0";
    elements.streak.textContent = "0";
    elements.progressBar.style.width = "0%";
    elements.dosageForm.textContent = "آماده شروع";
    elements.questionText.textContent = "یک مدل بازی از داشبورد انتخاب کنید.";
    elements.questionSubtitle.textContent = "";
    clearChildren(elements.options);
    elements.feedback.hidden = true;

    const randomButton = makeActionButton("شروع تصادفی", "primary-action", startRandomGame);
    const allButton = makeActionButton("کل داروها", "secondary-action", startAllGame);
    elements.options.append(randomButton, allButton);
  }

  function renderQuestion() {
    if (!quiz || quiz.index >= quiz.questions.length) {
      finishGame();
      return;
    }

    const drug = quiz.questions[quiz.index];
    quiz.currentAnswered = false;
    elements.gameModeLabel.textContent = quiz.label;
    elements.progress.textContent = `${formatNumber(quiz.index + 1)}/${formatNumber(quiz.questions.length)}`;
    elements.score.textContent = formatNumber(quiz.score);
    elements.correct.textContent = formatNumber(quiz.correct);
    elements.streak.textContent = formatNumber(quiz.streak);
    elements.progressBar.style.width = `${Math.round((quiz.index / quiz.questions.length) * 100)}%`;
    elements.dosageForm.textContent = drug.dosageForm || "فرم دارویی ثبت نشده";
    elements.questionText.innerHTML = `داروی <span class="drug-name">${escapeHtml(drug.name)}</span> چه زمانی نسبت به غذا مصرف می‌شود؟`;
    elements.questionSubtitle.textContent = drug.pname ? `نام فارسی: ${drug.pname}` : "";
    elements.feedback.hidden = true;
    clearChildren(elements.options);

    buildOptions(drug).forEach((option) => {
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

    const drug = quiz.questions[quiz.index];
    const correctAnswer = drug.consumptionTimeSorted;
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
      recordMistake(drug, selected);
      elements.feedbackStatus.textContent = "اشتباه";
      elements.feedbackStatus.className = "feedback-status wrong";
    }

    quiz.answers.push({
      drugId: drug.id,
      selected,
      correctAnswer,
      isCorrect,
    });

    store.totals.answered += 1;
    if (isCorrect) store.totals.correct += 1;
    saveStore();

    elements.score.textContent = formatNumber(quiz.score);
    elements.correct.textContent = formatNumber(quiz.correct);
    elements.streak.textContent = formatNumber(quiz.streak);
    elements.progressBar.style.width = `${Math.round(((quiz.index + 1) / quiz.questions.length) * 100)}%`;
    elements.feedbackNote.textContent = drug.consumptionTime || `پاسخ صحیح: ${correctAnswer}`;
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

    const answered = quiz.answers.length;
    const wrong = answered - quiz.correct;
    const percent = answered ? Math.round((quiz.correct / answered) * 100) : 0;
    const record = {
      id: makeId(),
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
      store.games.unshift(record);
      store.games = store.games.slice(0, 60);
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

  function buildOptions(drug) {
    const correctAnswer = drug.consumptionTimeSorted;
    const distractors = shuffle(OPTION_POOL.filter((option) => option !== correctAnswer)).slice(0, 3);
    return shuffle([correctAnswer, ...distractors]).slice(0, 4);
  }

  function recordMistake(drug, selected) {
    const previous = store.mistakes[drug.id] || {
      drugId: drug.id,
      name: drug.name,
      pname: drug.pname,
      correctAnswer: drug.consumptionTimeSorted,
      wrongCount: 0,
      lastWrongAnswer: "",
      lastAt: "",
    };

    store.mistakes[drug.id] = {
      ...previous,
      name: drug.name,
      pname: drug.pname,
      correctAnswer: drug.consumptionTimeSorted,
      wrongCount: previous.wrongCount + 1,
      lastWrongAnswer: selected,
      lastAt: new Date().toISOString(),
    };
  }

  function renderDashboard() {
    const bestScore = store.games.reduce((best, game) => Math.max(best, game.score || 0), 0);
    const accuracy = store.totals.answered
      ? Math.round((store.totals.correct / store.totals.answered) * 100)
      : 0;

    setMetric("totalDrugs", formatNumber(DRUGS.length));
    setMetric("bestScore", formatNumber(bestScore));
    setMetric("accuracy", `${formatNumber(accuracy)}٪`);
    setMetric("mistakeCount", formatNumber(getMistakeItems().length));

    renderRecentGames();
    renderTopMistakes();
  }

  function renderRecentGames() {
    clearChildren(elements.recentGames);
    const games = store.games.slice(0, 5);

    if (!games.length) {
      elements.recentGames.append(emptyState("هنوز امتیازی ذخیره نشده است."));
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
    const mistakes = getMistakeItems().slice(0, 5);

    if (!mistakes.length) {
      elements.topMistakes.append(emptyState("بانک خطاها خالی است."));
      return;
    }

    mistakes.forEach((mistake) => {
      const row = document.createElement("div");
      row.className = "mini-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${mistake.name} ${mistake.pname ? `- ${mistake.pname}` : ""}`;
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
    const mistakes = getMistakeItems();

    if (!mistakes.length) {
      elements.mistakeBoard.append(emptyState("هنوز پاسخ اشتباهی ثبت نشده است."));
      return;
    }

    mistakes.forEach((mistake) => {
      const drug = drugById.get(mistake.drugId);
      const row = document.createElement("article");
      row.className = "mistake-row";

      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = `${mistake.name}${mistake.pname ? ` | ${mistake.pname}` : ""}`;
      const description = document.createElement("p");
      description.textContent = drug?.consumptionTime || `پاسخ صحیح: ${mistake.correctAnswer}`;

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

    if (!store.games.length) {
      elements.scoreBoard.append(emptyState("هنوز بازی ثبت نشده است."));
      return;
    }

    store.games.forEach((game) => {
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
    if (!store.games.length && !store.totals.answered) return;
    const accepted = window.confirm("همه‌ی امتیازهای ذخیره‌شده پاک شوند؟");
    if (!accepted) return;
    store.games = [];
    store.totals = { answered: 0, correct: 0 };
    saveStore();
    renderDashboard();
    renderScores();
  }

  function resetMistakes() {
    if (!getMistakeItems().length) return;
    const accepted = window.confirm("همه‌ی خطاهای ذخیره‌شده پاک شوند؟");
    if (!accepted) return;
    store.mistakes = {};
    saveStore();
    renderDashboard();
    renderMistakes();
  }

  function exportReport() {
    const report = {
      exportedAt: new Date().toISOString(),
      totalDrugs: DRUGS.length,
      scores: store.games,
      mistakes: getMistakeItems(),
      totals: store.totals,
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

  function getMistakeItems() {
    return Object.values(store.mistakes)
      .filter((item) => item && item.drugId)
      .sort((a, b) => {
        if ((b.wrongCount || 0) !== (a.wrongCount || 0)) {
          return (b.wrongCount || 0) - (a.wrongCount || 0);
        }
        return String(b.lastAt || "").localeCompare(String(a.lastAt || ""));
      });
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

  function normalizeRandomCount(value) {
    const raw = Number(value || 20);
    const rounded = Math.round(raw / 10) * 10;
    return clamp(rounded, 10, Math.min(100, DRUGS.length || 10));
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
