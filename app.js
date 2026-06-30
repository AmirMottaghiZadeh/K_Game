(() => {
  "use strict";

  const STORAGE_KEY = "karamozi-drug-timing-game:v1";
  const TOPIC_KEY = "karamozi-drug-timing-game:topic";
  const SETTINGS_KEY = "karamozi-drug-timing-game:settings";
  const USERS_KEY = "karamozi-drug-game:users:v1";
  const ACTIVE_USER_KEY = "karamozi-drug-game:active-user";
  const DEFAULT_SETTINGS = {
    timerSeconds: 30,
    theme: "light",
  };
  const MIN_TIMER_SECONDS = 5;
  const MAX_TIMER_SECONDS = 180;
  const TIMER_TICK_MS = 250;
  const LEAGUE_QUESTION_COUNT = 50;
  const TIMEOUT_ANSWER = "پایان زمان";
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
  let settings = loadSettings();
  let users = loadUsers();
  let activeUserId = loadActiveUserId();
  let activeUser = users.find((user) => user.id === activeUserId) || null;
  if (!activeUser) activeUserId = "";
  let store = loadCurrentStore();
  let quiz = null;
  let timerIntervalId = null;

  const elements = {
    views: [...document.querySelectorAll(".view")],
    navButtons: [...document.querySelectorAll("[data-nav]")],
    topicRadios: [...document.querySelectorAll("input[name='question-topic']")],
    modeRadios: [...document.querySelectorAll("input[name='game-mode']")],
    themeRadios: [...document.querySelectorAll("input[name='theme-mode']")],
    leagueButtons: [...document.querySelectorAll("[data-league-topic]")],
    randomCount: document.querySelector("#random-count"),
    timerDuration: document.querySelector("[data-timer-duration]"),
    timerRange: document.querySelector("[data-timer-range]"),
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
    currentTimer: document.querySelector("[data-current-timer]"),
    questionTimer: document.querySelector("[data-question-timer]"),
    timerBar: document.querySelector("[data-timer-bar]"),
    timerState: document.querySelector("[data-timer-state]"),
    timerMetric: document.querySelector("[data-timer-metric]"),
    progressBar: document.querySelector("[data-progress-bar]"),
    gameModeLabel: document.querySelector("[data-game-mode-label]"),
    recentGames: document.querySelector("[data-recent-games]"),
    topMistakes: document.querySelector("[data-top-mistakes]"),
    mistakeBoard: document.querySelector("[data-mistake-board]"),
    scoreBoard: document.querySelector("[data-score-board]"),
    loginForm: document.querySelector("[data-login-form]"),
    signupForm: document.querySelector("[data-signup-form]"),
    loginUsername: document.querySelector("[data-login-username]"),
    loginPassword: document.querySelector("[data-login-password]"),
    signupUsername: document.querySelector("[data-signup-username]"),
    signupPassword: document.querySelector("[data-signup-password]"),
    authPanel: document.querySelector("[data-auth-panel]"),
    profilePanel: document.querySelector("[data-profile-panel]"),
    accountGrid: document.querySelector(".account-grid"),
    authStatus: document.querySelector("[data-auth-status]"),
    logout: document.querySelector("[data-logout]"),
    userProfile: document.querySelector("[data-user-profile]"),
    activityBoard: document.querySelector("[data-activity-board]"),
    currentUser: document.querySelector("[data-current-user]"),
    accountUser: document.querySelector("[data-account-user]"),
    leagueUser: document.querySelector("[data-league-user]"),
    leagueBoard: document.querySelector("[data-league-board]"),
    leagueHistory: document.querySelector("[data-league-history]"),
  };

  init();

  function init() {
    elements.randomCount.value = "20";
    applyTheme(settings.theme);
    syncSettingsControls();

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

    elements.themeRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        settings.theme = radio.value === "dark" ? "dark" : "light";
        saveSettings();
        applyTheme(settings.theme);
        syncSettingsControls();
      });
    });

    elements.timerDuration.addEventListener("change", () => updateTimerSetting(elements.timerDuration.value));
    elements.timerRange.addEventListener("input", () => updateTimerSetting(elements.timerRange.value));
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.signupForm.addEventListener("submit", handleSignup);
    elements.logout.addEventListener("click", logoutUser);
    elements.leagueButtons.forEach((button) => {
      button.addEventListener("click", () => startLeagueGame(button.dataset.leagueTopic));
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
    syncSettingsControls();
    updateUserChrome();
    renderDashboard();
    renderIdleGame();
    renderAccount();
    renderLeague();
    registerServiceWorker();
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return makeEmptyStore();
      const parsed = JSON.parse(raw);
      return normalizeStore(parsed);
    } catch {
      return makeEmptyStore();
    }
  }

  function saveStore() {
    if (activeUser) {
      activeUser.store = store;
      activeUser.updatedAt = new Date().toISOString();
      persistActiveUser();
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Browsers may block localStorage in strict private modes; the game keeps running in memory.
    }
  }

  function loadCurrentStore() {
    return activeUser ? normalizeStore(activeUser.store) : loadStore();
  }

  function normalizeStore(value) {
    const nextStore = makeEmptyStore();

    if (value?.topics && typeof value.topics === "object") {
      TOPIC_IDS.forEach((topicId) => {
        nextStore.topics[topicId] = normalizeTopicStore(value.topics[topicId]);
      });
      return nextStore;
    }

    if (value && typeof value === "object") {
      nextStore.topics.timing = normalizeTopicStore(value);
    }

    return nextStore;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return normalizeSettings(parsed);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings still apply for the current session when storage is blocked.
    }
  }

  function normalizeSettings(value) {
    const theme = value?.theme === "dark" ? "dark" : "light";
    return {
      timerSeconds: normalizeTimerSeconds(value?.timerSeconds ?? DEFAULT_SETTINGS.timerSeconds),
      theme,
    };
  }

  function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(normalizeUser).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function saveUsers() {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch {
      // User data remains available in memory until the page is closed.
    }
  }

  function loadActiveUserId() {
    try {
      return localStorage.getItem(ACTIVE_USER_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveActiveUserId() {
    try {
      if (activeUser) {
        localStorage.setItem(ACTIVE_USER_KEY, activeUser.id);
      } else {
        localStorage.removeItem(ACTIVE_USER_KEY);
      }
    } catch {
      // The current in-memory session still works if storage is blocked.
    }
  }

  function normalizeUser(user) {
    if (!user || typeof user !== "object") return null;
    const id = normalizeUsername(user.id || user.username);
    if (!id || !user.passwordHash || !user.salt) return null;
    return {
      id,
      username: String(user.username || id).trim() || id,
      salt: String(user.salt),
      passwordHash: String(user.passwordHash),
      passwordMethod: user.passwordMethod === "fallback" ? "fallback" : "sha256",
      createdAt: user.createdAt || new Date().toISOString(),
      lastLoginAt: user.lastLoginAt || "",
      updatedAt: user.updatedAt || "",
      store: normalizeStore(user.store),
      activities: Array.isArray(user.activities) ? user.activities.slice(0, 160) : [],
      leagueResults: Array.isArray(user.leagueResults) ? user.leagueResults.slice(0, 120) : [],
    };
  }

  function persistActiveUser() {
    if (!activeUser) return;
    const index = users.findIndex((user) => user.id === activeUser.id);
    if (index >= 0) {
      users[index] = activeUser;
    } else {
      users.push(activeUser);
    }
    saveUsers();
    saveActiveUserId();
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

  function applyTheme(theme) {
    const safeTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = safeTheme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", safeTheme === "dark" ? "#08111f" : "#0f766e");
  }

  function syncSettingsControls() {
    elements.timerDuration.value = String(settings.timerSeconds);
    elements.timerRange.value = String(settings.timerSeconds);
    elements.themeRadios.forEach((radio) => {
      const isSelected = radio.value === settings.theme;
      radio.checked = isSelected;
      radio.closest(".theme-option").classList.toggle("is-selected", isSelected);
    });
  }

  function updateTimerSetting(value) {
    settings.timerSeconds = normalizeTimerSeconds(value);
    saveSettings();
    syncSettingsControls();
    if (!quiz || quiz.currentAnswered) {
      updateTimerDisplay(settings.timerSeconds, settings.timerSeconds);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    const username = elements.signupUsername.value.trim();
    const password = elements.signupPassword.value;
    const id = normalizeUsername(username);

    if (id.length < 2 || password.length < 4) {
      setAuthStatus("نام کاربری حداقل ۲ کاراکتر و پسورد حداقل ۴ کاراکتر باشد.", "wrong");
      return;
    }

    if (users.some((user) => user.id === id)) {
      setAuthStatus("این نام کاربری قبلا ساخته شده است.", "wrong");
      return;
    }

    const passwordMethod = canUseSecureHash() ? "sha256" : "fallback";
    const salt = makeSalt();
    const passwordHash = await makePasswordHash(password, salt, passwordMethod);
    const now = new Date().toISOString();
    activeUser = {
      id,
      username,
      salt,
      passwordHash,
      passwordMethod,
      createdAt: now,
      lastLoginAt: now,
      updatedAt: now,
      store: makeEmptyStore(),
      activities: [],
      leagueResults: [],
    };
    activeUserId = id;
    store = normalizeStore(activeUser.store);
    addActivity({ type: "account", label: "ساخت کاربر", detail: activeUser.username }, { persist: false });
    persistActiveUser();
    clearAuthForms();
    setAuthStatus("کاربر ساخته و وارد شد.", "correct");
    refreshUserViews();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const id = normalizeUsername(elements.loginUsername.value);
    const password = elements.loginPassword.value;
    const user = users.find((item) => item.id === id);

    if (!user) {
      setAuthStatus("کاربر پیدا نشد.", "wrong");
      return;
    }

    if (user.passwordMethod === "sha256" && !canUseSecureHash()) {
      setAuthStatus("این مرورگر امکان بررسی امن پسورد این کاربر را ندارد.", "wrong");
      return;
    }

    const passwordHash = await makePasswordHash(password, user.salt, user.passwordMethod);
    if (passwordHash !== user.passwordHash) {
      setAuthStatus("پسورد درست نیست.", "wrong");
      return;
    }

    activeUser = user;
    activeUserId = user.id;
    activeUser.lastLoginAt = new Date().toISOString();
    store = normalizeStore(activeUser.store);
    addActivity({ type: "account", label: "ورود", detail: activeUser.username }, { persist: false });
    persistActiveUser();
    clearAuthForms();
    setAuthStatus("ورود انجام شد.", "correct");
    refreshUserViews();
  }

  function logoutUser() {
    if (!activeUser) return;
    stopQuestionTimer();
    quiz = null;
    activeUser = null;
    activeUserId = "";
    store = loadStore();
    saveActiveUserId();
    setAuthStatus("از حساب خارج شدید.", "");
    refreshUserViews();
    renderIdleGame();
    navigate("account");
  }

  function refreshUserViews() {
    updateUserChrome();
    renderDashboard();
    renderMistakes();
    renderScores();
    renderAccount();
    renderLeague();
  }

  function navigate(viewId) {
    elements.views.forEach((view) => view.classList.toggle("is-active", view.id === viewId));
    elements.navButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.nav === viewId);
    });

    if (viewId === "mistakes") renderMistakes();
    if (viewId === "scores") renderScores();
    if (viewId === "dashboard") renderDashboard();
    if (viewId === "settings") syncSettingsControls();
    if (viewId === "account") renderAccount();
    if (viewId === "league") renderLeague();
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

  function startLeagueGame(topicId) {
    if (!activeUser) {
      setAuthStatus("برای شروع لیگ ابتدا وارد حساب کاربری شوید.", "wrong");
      navigate("account");
      return;
    }

    const topic = getTopic(topicId);
    if (topic.data.length < LEAGUE_QUESTION_COUNT) {
      window.alert(`${topic.label} برای لیگ ۵۰ سؤال کافی ندارد.`);
      return;
    }

    const questions = shuffle(topic.data).slice(0, LEAGUE_QUESTION_COUNT);
    beginQuiz(questions, `${topic.label} | لیگ ۵۰ سؤالی`, "league", topic.id, { isLeague: true });
  }

  function beginQuiz(questions, label, mode, topicId, options = {}) {
    quiz = {
      questions,
      label,
      mode,
      topicId,
      isLeague: Boolean(options.isLeague),
      index: 0,
      score: 0,
      correct: 0,
      streak: 0,
      timeRemainingTotal: 0,
      answers: [],
      saved: false,
      startedAt: Date.now(),
      currentAnswered: false,
      timerSeconds: settings.timerSeconds,
      remainingSeconds: settings.timerSeconds,
      questionEndsAt: 0,
    };

    renderQuestion();
    navigate("game");
  }

  function renderIdleGame() {
    stopQuestionTimer();
    const topic = getActiveTopic();
    elements.gameModeLabel.textContent = topic.label;
    elements.progress.textContent = "0/0";
    elements.score.textContent = "0";
    elements.correct.textContent = "0";
    elements.streak.textContent = "0";
    updateTimerDisplay(settings.timerSeconds, settings.timerSeconds);
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
    quiz.timerSeconds = settings.timerSeconds;
    quiz.remainingSeconds = quiz.timerSeconds;
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
    updateTimerDisplay(quiz.remainingSeconds, quiz.timerSeconds);

    buildOptions(drug, topic).forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-button";
      button.dataset.choice = ["A", "B", "C", "D"][index] || String(index + 1);
      button.textContent = option;
      button.addEventListener("click", () => answerQuestion(option, button));
      elements.options.append(button);
    });

    startQuestionTimer();
  }

  function answerQuestion(selected, button, options = {}) {
    if (!quiz || quiz.currentAnswered) return;

    const isTimedOut = Boolean(options.timedOut);
    const remainingAtAnswer = isTimedOut ? 0 : getCurrentRemainingSeconds();
    stopQuestionTimer();
    const topic = getTopic(quiz.topicId);
    const drug = quiz.questions[quiz.index];
    const correctAnswer = topic.getAnswer(drug);
    const isCorrect = !isTimedOut && selected === correctAnswer;
    quiz.currentAnswered = true;
    quiz.remainingSeconds = remainingAtAnswer;

    [...elements.options.querySelectorAll(".option-button")].forEach((optionButton) => {
      optionButton.disabled = true;
      if (optionButton.textContent === correctAnswer) optionButton.classList.add("is-correct");
    });

    if (isCorrect) {
      const streakBonus = Math.min(quiz.streak, 5) * 2;
      quiz.streak += 1;
      quiz.correct += 1;
      quiz.score += 10 + streakBonus;
      if (quiz.isLeague) quiz.timeRemainingTotal += remainingAtAnswer;
      elements.feedbackStatus.textContent = `درست +${formatNumber(10 + streakBonus)}`;
      elements.feedbackStatus.className = "feedback-status correct";
    } else {
      quiz.streak = 0;
      if (button) button.classList.add("is-wrong");
      recordMistake(topic, drug, selected);
      elements.feedbackStatus.textContent = isTimedOut ? "زمان تمام شد" : "اشتباه";
      elements.feedbackStatus.className = "feedback-status wrong";
    }

    quiz.answers.push({
      drugId: drug.id,
      topicId: topic.id,
      selected,
      correctAnswer,
      isCorrect,
      remainingSeconds: remainingAtAnswer,
    });

    const topicStore = getTopicStore(topic.id);
    topicStore.totals.answered += 1;
    if (isCorrect) topicStore.totals.correct += 1;
    saveStore();

    elements.score.textContent = formatNumber(quiz.score);
    elements.correct.textContent = formatNumber(quiz.correct);
    elements.streak.textContent = formatNumber(quiz.streak);
    elements.progressBar.style.width = `${Math.round(((quiz.index + 1) / quiz.questions.length) * 100)}%`;
    elements.feedbackNote.textContent = isTimedOut
      ? `پاسخ در زمان تعیین‌شده ثبت نشد. ${topic.getFeedback(drug)}`
      : topic.getFeedback(drug);
    elements.nextQuestion.textContent =
      quiz.index + 1 >= quiz.questions.length ? "مشاهده نتیجه" : "سؤال بعدی";
    elements.feedback.hidden = false;
  }

  function startQuestionTimer() {
    stopQuestionTimer();
    if (!quiz || quiz.currentAnswered) return;
    quiz.questionEndsAt = Date.now() + quiz.timerSeconds * 1000;
    timerIntervalId = window.setInterval(tickQuestionTimer, TIMER_TICK_MS);
    tickQuestionTimer();
  }

  function stopQuestionTimer() {
    if (!timerIntervalId) return;
    window.clearInterval(timerIntervalId);
    timerIntervalId = null;
  }

  function tickQuestionTimer() {
    if (!quiz || quiz.currentAnswered) {
      stopQuestionTimer();
      return;
    }

    const remainingMs = quiz.questionEndsAt - Date.now();
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    quiz.remainingSeconds = remainingSeconds;
    updateTimerDisplay(remainingSeconds, quiz.timerSeconds);

    if (remainingMs <= 0) {
      stopQuestionTimer();
      answerQuestion(TIMEOUT_ANSWER, null, { timedOut: true });
    }
  }

  function getCurrentRemainingSeconds() {
    if (!quiz?.questionEndsAt) return 0;
    return Math.max(0, Math.ceil((quiz.questionEndsAt - Date.now()) / 1000));
  }

  function updateTimerDisplay(remainingSeconds, limitSeconds) {
    const remaining = clamp(Number(remainingSeconds), 0, MAX_TIMER_SECONDS);
    const limit = Math.max(1, Number(limitSeconds || settings.timerSeconds || DEFAULT_SETTINGS.timerSeconds));
    const ratio = Math.max(0, Math.min(1, remaining / limit));
    const state = ratio <= 0.2 ? "urgent" : ratio <= 0.45 ? "warning" : "ready";

    elements.currentTimer.textContent = formatNumber(remaining);
    elements.questionTimer.textContent = formatNumber(remaining);
    elements.timerBar.style.width = `${Math.round(ratio * 100)}%`;
    elements.timerBar.dataset.timerState = state;
    elements.timerState.dataset.timerState = state;
    elements.timerMetric.dataset.timerState = state;
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

    stopQuestionTimer();
    const topic = getTopic(quiz.topicId);
    const topicStore = getTopicStore(topic.id);
    const answered = quiz.answers.length;
    const wrong = answered - quiz.correct;
    const percent = answered ? Math.round((quiz.correct / answered) * 100) : 0;
    const isLeague = quiz.isLeague;
    const leagueScore = isLeague ? roundMetric(quiz.score / LEAGUE_QUESTION_COUNT) : 0;
    const timeBonus = isLeague ? roundMetric(quiz.timeRemainingTotal / LEAGUE_QUESTION_COUNT) : 0;
    const leagueRating = isLeague ? roundMetric(leagueScore + timeBonus) : 0;
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
      isLeague,
      scorePerQuestion: leagueScore,
      timeRemainingTotal: quiz.timeRemainingTotal,
      timeBonus,
      leagueRating,
    };

    if (!quiz.saved && answered > 0 && !isLeague) {
      topicStore.games.unshift(record);
      topicStore.games = topicStore.games.slice(0, 60);
      quiz.saved = true;
      saveStore();
    }

    if (!quiz.saved && answered > 0 && isLeague) {
      saveLeagueResult(record);
      quiz.saved = true;
    }

    if (answered > 0 && !isLeague) {
      addActivity({
        type: "practice",
        label: record.label,
        topicLabel: topic.label,
        score: record.score,
        percent: record.percent,
        endedAt: record.endedAt,
      });
    }

    elements.gameModeLabel.textContent = "نتیجه";
    elements.progress.textContent = `${formatNumber(answered)}/${formatNumber(quiz.questions.length)}`;
    elements.score.textContent = formatNumber(quiz.score);
    elements.correct.textContent = formatNumber(quiz.correct);
    elements.streak.textContent = formatNumber(quiz.streak);
    updateTimerDisplay(0, settings.timerSeconds);
    elements.progressBar.style.width = "100%";
    elements.dosageForm.textContent = "پایان بازی";
    elements.questionText.textContent = "نتیجه بازی";
    elements.questionSubtitle.textContent = isLeague
      ? `${formatNumber(quiz.correct)} پاسخ درست، امتیاز لیگ ${formatDecimal(leagueScore)}، مزیت زمان ${formatDecimal(timeBonus)}`
      : `${formatNumber(quiz.correct)} پاسخ درست، ${formatNumber(wrong)} پاسخ اشتباه، دقت ${formatNumber(percent)}٪`;
    elements.feedback.hidden = true;
    clearChildren(elements.options);

    const summaryItems = [
      makeSummaryTile("امتیاز", formatNumber(quiz.score)),
      makeSummaryTile("سؤال پاسخ‌داده‌شده", formatNumber(answered)),
      makeSummaryTile("دقت", `${formatNumber(percent)}٪`),
      makeSummaryTile("زمان", `${formatNumber(record.durationSeconds)} ثانیه`),
    ];

    if (isLeague) {
      summaryItems.push(
        makeSummaryTile("امتیاز لیگ", formatDecimal(leagueScore)),
        makeSummaryTile("مزیت زمان", formatDecimal(timeBonus)),
        makeSummaryTile("رتبه‌پذیری", formatDecimal(leagueRating)),
        makeActionButton("بازگشت به لیگ", "primary-action", () => navigate("league"))
      );
    } else {
      summaryItems.push(
        makeActionButton("بازی تصادفی جدید", "primary-action", startRandomGame),
        makeActionButton("دیدن خطاها", "secondary-action", () => navigate("mistakes"))
      );
    }

    elements.options.append(...summaryItems);

    renderDashboard();
    renderMistakes();
    renderScores();
    renderAccount();
    renderLeague();
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

  function renderAccount() {
    const isLoggedIn = Boolean(activeUser);
    elements.accountGrid.classList.toggle("is-logged-in", isLoggedIn);
    elements.authPanel.hidden = isLoggedIn;
    elements.profilePanel.hidden = !isLoggedIn;

    clearChildren(elements.userProfile);
    clearChildren(elements.activityBoard);

    if (!isLoggedIn) {
      elements.activityBoard.append(emptyState("فعالیتی برای کاربر مهمان ثبت نمی‌شود."));
      return;
    }

    const totalGames = TOPIC_IDS.reduce((sum, topicId) => sum + getTopicStore(topicId).games.length, 0);
    const totalMistakes = TOPIC_IDS.reduce((sum, topicId) => sum + getMistakeItems(topicId).length, 0);
    const bestLeague = getBestLeagueResult(activeUser);

    elements.userProfile.append(
      makeSummaryTile("نام کاربری", activeUser.username),
      makeSummaryTile("بازی‌ها", formatNumber(totalGames)),
      makeSummaryTile("خطاها", formatNumber(totalMistakes)),
      makeSummaryTile("بهترین لیگ", bestLeague ? formatDecimal(bestLeague.leagueRating) : "0")
    );

    if (!activeUser.activities.length) {
      elements.activityBoard.append(emptyState("هنوز فعالیتی ثبت نشده است."));
      return;
    }

    activeUser.activities.slice(0, 12).forEach((activity) => {
      const row = document.createElement("article");
      row.className = "activity-row";
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = activity.label;
      const detail = document.createElement("p");
      detail.textContent = [activity.topicLabel, activity.detail, formatDate(activity.endedAt || activity.createdAt)]
        .filter(Boolean)
        .join(" | ");
      const tags = document.createElement("div");
      tags.className = "meta-tags";
      if (activity.score !== undefined) tags.append(makeTag(`امتیاز: ${formatNumber(activity.score)}`, ""));
      if (activity.percent !== undefined) tags.append(makeTag(`دقت: ${formatNumber(activity.percent)}٪`, "correct"));
      if (activity.leagueRating !== undefined) tags.append(makeTag(`رتبه‌پذیری: ${formatDecimal(activity.leagueRating)}`, ""));
      copy.append(title, detail, tags);
      row.append(copy);
      elements.activityBoard.append(row);
    });
  }

  function renderLeague() {
    elements.leagueButtons.forEach((button) => {
      const topic = getTopic(button.dataset.leagueTopic);
      button.disabled = !activeUser || topic.data.length < LEAGUE_QUESTION_COUNT;
    });

    clearChildren(elements.leagueBoard);
    clearChildren(elements.leagueHistory);

    const standings = getLeagueStandings();
    if (!standings.length) {
      elements.leagueBoard.append(emptyState("هنوز نتیجه‌ای در لیگ ثبت نشده است."));
    } else {
      standings.forEach((entry, index) => {
        elements.leagueBoard.append(makeLeagueRow(entry, index + 1));
      });
    }

    if (!activeUser) {
      elements.leagueHistory.append(emptyState("برای ثبت نتیجه لیگ وارد حساب کاربری شوید."));
      updateUserChrome();
      return;
    }

    const history = [...activeUser.leagueResults].sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
    if (!history.length) {
      elements.leagueHistory.append(emptyState("هنوز مسابقه لیگ برای این کاربر ثبت نشده است."));
    } else {
      history.slice(0, 10).forEach((result, index) => {
        elements.leagueHistory.append(makeLeagueRow({ ...result, username: activeUser.username }, index + 1, true));
      });
    }

    updateUserChrome();
  }

  function makeLeagueRow(entry, rank, compact = false) {
    const row = document.createElement("article");
    row.className = "league-row";

    const rankBadge = document.createElement("div");
    rankBadge.className = "rank-badge";
    rankBadge.textContent = formatNumber(rank);

    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = compact ? entry.topicLabel : entry.username;
    const detail = document.createElement("p");
    detail.textContent = compact
      ? `${formatDate(entry.endedAt)} | ${formatNumber(entry.correct)}/${formatNumber(entry.answered)} درست`
      : `${entry.topicLabel} | ${formatNumber(entry.correct)}/${formatNumber(entry.answered)} درست`;
    const tags = document.createElement("div");
    tags.className = "meta-tags";
    tags.append(
      makeTag(`امتیاز لیگ: ${formatDecimal(entry.scorePerQuestion)}`, "correct"),
      makeTag(`مزیت زمان: ${formatDecimal(entry.timeBonus)}`, ""),
      makeTag(`رتبه‌پذیری: ${formatDecimal(entry.leagueRating)}`, "")
    );

    copy.append(title, detail, tags);

    const stat = document.createElement("div");
    stat.className = "row-stat";
    stat.append(document.createTextNode(formatDecimal(entry.leagueRating)));
    const small = document.createElement("small");
    small.textContent = "لیگ";
    stat.append(small);

    row.append(rankBadge, copy, stat);
    return row;
  }

  function saveLeagueResult(record) {
    if (!activeUser) return;
    const result = {
      id: record.id,
      userId: activeUser.id,
      username: activeUser.username,
      topicId: record.topicId,
      topicLabel: record.topicLabel,
      rawScore: record.score,
      scorePerQuestion: record.scorePerQuestion,
      timeRemainingTotal: record.timeRemainingTotal,
      timeBonus: record.timeBonus,
      leagueRating: record.leagueRating,
      answered: record.answered,
      correct: record.correct,
      wrong: record.wrong,
      percent: record.percent,
      durationSeconds: record.durationSeconds,
      endedAt: record.endedAt,
    };

    activeUser.leagueResults.unshift(result);
    activeUser.leagueResults = activeUser.leagueResults.slice(0, 120);
    addActivity(
      {
        type: "league",
        label: `لیگ ${record.topicLabel}`,
        topicLabel: record.topicLabel,
        score: record.score,
        percent: record.percent,
        leagueRating: record.leagueRating,
        endedAt: record.endedAt,
      },
      { persist: false }
    );
    persistActiveUser();
  }

  function getLeagueStandings() {
    return users
      .map((user) => {
        const best = getBestLeagueResult(user);
        return best ? { ...best, username: user.username } : null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if ((b.leagueRating || 0) !== (a.leagueRating || 0)) return (b.leagueRating || 0) - (a.leagueRating || 0);
        if ((b.scorePerQuestion || 0) !== (a.scorePerQuestion || 0)) return (b.scorePerQuestion || 0) - (a.scorePerQuestion || 0);
        return String(b.endedAt || "").localeCompare(String(a.endedAt || ""));
      });
  }

  function getBestLeagueResult(user) {
    if (!user?.leagueResults?.length) return null;
    return [...user.leagueResults].sort((a, b) => {
      if ((b.leagueRating || 0) !== (a.leagueRating || 0)) return (b.leagueRating || 0) - (a.leagueRating || 0);
      if ((b.scorePerQuestion || 0) !== (a.scorePerQuestion || 0)) return (b.scorePerQuestion || 0) - (a.scorePerQuestion || 0);
      return String(b.endedAt || "").localeCompare(String(a.endedAt || ""));
    })[0];
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

  function addActivity(activity, options = {}) {
    if (!activeUser) return;
    const nextActivity = {
      id: makeId(),
      type: activity.type || "activity",
      label: activity.label || "فعالیت",
      detail: activity.detail || "",
      topicLabel: activity.topicLabel || "",
      score: activity.score,
      percent: activity.percent,
      leagueRating: activity.leagueRating,
      createdAt: new Date().toISOString(),
      endedAt: activity.endedAt || "",
    };
    activeUser.activities.unshift(nextActivity);
    activeUser.activities = activeUser.activities.slice(0, 160);
    if (options.persist !== false) persistActiveUser();
  }

  function updateUserChrome() {
    const label = activeUser ? activeUser.username : "مهمان";
    elements.currentUser.textContent = label;
    elements.accountUser.textContent = label;
    elements.leagueUser.textContent = label;
  }

  function clearAuthForms() {
    elements.loginUsername.value = "";
    elements.loginPassword.value = "";
    elements.signupUsername.value = "";
    elements.signupPassword.value = "";
  }

  function setAuthStatus(message, variant) {
    elements.authStatus.textContent = message;
    elements.authStatus.className = variant ? `auth-status ${variant}` : "auth-status";
  }

  function exportReport() {
    const report = {
      exportedAt: new Date().toISOString(),
      activeUser: activeUser
        ? {
            id: activeUser.id,
            username: activeUser.username,
            activities: activeUser.activities,
            leagueResults: activeUser.leagueResults,
          }
        : null,
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

  function normalizeTimerSeconds(value) {
    return clamp(Number(value || DEFAULT_SETTINGS.timerSeconds), MIN_TIMER_SECONDS, MAX_TIMER_SECONDS);
  }

  function normalizeUsername(value) {
    return String(value || "").trim().toLocaleLowerCase();
  }

  function roundMetric(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function formatNumber(value) {
    return numberFormatter.format(Number(value || 0));
  }

  function formatDecimal(value) {
    return numberFormatter.format(roundMetric(value));
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

  function makeSalt() {
    if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return bytesToHex(bytes);
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function canUseSecureHash() {
    return Boolean(window.crypto?.subtle && window.TextEncoder);
  }

  async function makePasswordHash(password, salt, method) {
    const input = `${salt}:${password}`;
    if (method === "sha256" && canUseSecureHash()) {
      const data = new TextEncoder().encode(input);
      const digest = await window.crypto.subtle.digest("SHA-256", data);
      return bytesToHex(new Uint8Array(digest));
    }
    return fallbackHash(input);
  }

  function bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function fallbackHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
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
