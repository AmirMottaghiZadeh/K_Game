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
  const FLASHCARD_TOPIC_IDS = ["brandGeneric", "indication", "sideEffects"];
  const LEITNER_BOX_COUNT = 5;
  const LEITNER_BOX_LABELS = ["خطای تازه", "نیازمند مرور", "پرتکرار", "سخت", "بسیار سخت"];
  const TIMEOUT_ANSWER = "پایان زمان";
  const INVALID_ANSWER_OPTIONS = new Set(["ثبت نشده", ""]);
  const VALID_TIMING_ANSWERS = new Set(["با غذا", "بدون غذا", "فرقی نمی‌کند", "وضعیت ثابت"]);
  const BRAND_GENERIC_EXCLUDED_BRAND_SIGNATURES = new Set([
    "metformin",
    "empagliflozin",
    "linagliptin",
    "insulin",
  ]);
  const STATIC_GENERIC_SIGNATURE_ALIASES = {
    doxepin: "دوکسپین",
    olanzapine: "اولانزاپین",
    risperidone: "ریسپریدون",
    quetiapine: "کوئتیاپین",
    aripiprazole: "اریپیپرازول",
    carbamazepine: "کاربامازپین",
    lamotrigine: "لاموتریژین",
    amantadine: "امانتادین",
  };
  const SUPABASE_CONFIG = window.KARAMOZI_SUPABASE || {};
  const SUPABASE_ENABLED = Boolean(
    SUPABASE_CONFIG.url &&
      SUPABASE_CONFIG.anonKey &&
      window.supabase?.createClient
  );
  const TIMING_DRUGS = Array.isArray(window.DRUGS_DATA)
    ? window.DRUGS_DATA.filter((drug) => drug.name && VALID_TIMING_ANSWERS.has(drug.consumptionTimeSorted))
    : [];
  const TOPIC_DRUGS = Array.isArray(window.DRUG_TOPIC_DATA)
    ? window.DRUG_TOPIC_DATA.filter((drug) => drug.brandName && drug.genericName)
    : [];
  const GENERIC_ALIAS_SIGNATURES = makeGenericAliasSignatureMap(TOPIC_DRUGS);
  const BRAND_GENERIC_DRUGS = makeBrandGenericDrugRows(TOPIC_DRUGS);
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
      data: BRAND_GENERIC_DRUGS,
      getAnswer: (drug) => drug.genericName,
      getName: (drug) => drug.brandName,
      getSubtitle: (drug) => drug.drugClassification || "",
      getChip: (drug) => drug.drugClassification || "نام تجاری دارو",
      getQuestionHtml: (drug) =>
        `نام ژنریک داروی تجاری <span class="drug-name">${escapeHtml(drug.brandName)}</span> کدام است؟`,
      getSubtitleText: (drug) => drug.drugClassification || "",
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
      getChip: (drug) => drug.drugClassification || "اندیکاسیون",
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
      getChip: (drug) => drug.drugClassification || "عوارض جانبی",
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
      makeOptionPool(TOPICS[topicId]),
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
  let selectedFlashcardTopicId = FLASHCARD_TOPIC_IDS.includes(selectedTopicId) ? selectedTopicId : "brandGeneric";
  let selectedFlashcardCategory = "";
  let selectedLeitnerBox = 0;
  let settings = loadSettings();
  let users = loadUsers();
  let activeUserId = loadActiveUserId();
  let activeUser = users.find((user) => user.id === activeUserId) || null;
  if (!activeUser) activeUserId = "";
  let store = loadCurrentStore();
  let supabaseClient = null;
  let cloudMode = false;
  let cloudLeagueStandings = [];
  let quiz = null;
  let timerIntervalId = null;
  let flashcardSession = {
    topicId: selectedFlashcardTopicId,
    current: null,
    revealed: false,
  };

  const elements = {
    views: [...document.querySelectorAll(".view")],
    navButtons: [...document.querySelectorAll("[data-nav]")],
    topicRadios: [...document.querySelectorAll("input[name='question-topic']")],
    modeRadios: [...document.querySelectorAll("input[name='game-mode']")],
    themeRadios: [...document.querySelectorAll("input[name='theme-mode']")],
    leagueButtons: [...document.querySelectorAll("[data-league-topic]")],
    flashcardTopicButtons: [...document.querySelectorAll("[data-flashcard-topic]")],
    flashcardCategory: document.querySelector("[data-flashcard-category]"),
    flashcardCategoryCount: document.querySelector("[data-flashcard-category-count]"),
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
    loginForms: [...document.querySelectorAll("[data-login-form]")],
    signupForms: [...document.querySelectorAll("[data-signup-form]")],
    loginEmails: [...document.querySelectorAll("[data-login-email]")],
    loginPasswords: [...document.querySelectorAll("[data-login-password]")],
    signupUsernames: [...document.querySelectorAll("[data-signup-username]")],
    signupEmails: [...document.querySelectorAll("[data-signup-email]")],
    signupPasswords: [...document.querySelectorAll("[data-signup-password]")],
    dashboardAuthPanel: document.querySelector("[data-dashboard-auth-panel]"),
    dashboardAuthGuest: document.querySelector("[data-dashboard-auth-guest]"),
    dashboardAuthProfile: document.querySelector("[data-dashboard-auth-profile]"),
    dashboardUserProfile: document.querySelector("[data-dashboard-user-profile]"),
    dashboardUser: document.querySelector("[data-dashboard-user]"),
    authPanel: document.querySelector("[data-auth-panel]"),
    profilePanel: document.querySelector("[data-profile-panel]"),
    accountGrid: document.querySelector(".account-grid"),
    authStatusMessages: [...document.querySelectorAll("[data-auth-status]")],
    logoutButtons: [...document.querySelectorAll("[data-logout]")],
    userProfile: document.querySelector("[data-user-profile]"),
    activityBoard: document.querySelector("[data-activity-board]"),
    currentUser: document.querySelector("[data-current-user]"),
    accountUser: document.querySelector("[data-account-user]"),
    leagueUser: document.querySelector("[data-league-user]"),
    leagueBoard: document.querySelector("[data-league-board]"),
    leagueHistory: document.querySelector("[data-league-history]"),
    flashcardUser: document.querySelector("[data-flashcard-user]"),
    flashcardTopicLabel: document.querySelector("[data-flashcard-topic-label]"),
    flashcardDue: document.querySelector("[data-flashcard-due]"),
    flashcardCurrentBox: document.querySelector("[data-flashcard-current-box]"),
    flashcardReviewed: document.querySelector("[data-flashcard-reviewed]"),
    flashcardAccuracy: document.querySelector("[data-flashcard-accuracy]"),
    flashcardCard: document.querySelector("[data-flashcard-card]"),
    flashcardFrontLabel: document.querySelector("[data-flashcard-front-label]"),
    flashcardFront: document.querySelector("[data-flashcard-front]"),
    flashcardSubtitle: document.querySelector("[data-flashcard-subtitle]"),
    flashcardAnswer: document.querySelector("[data-flashcard-answer]"),
    flashcardBack: document.querySelector("[data-flashcard-back]"),
    flashcardShow: document.querySelector("[data-flashcard-show]"),
    flashcardWrong: document.querySelector("[data-flashcard-wrong]"),
    flashcardCorrect: document.querySelector("[data-flashcard-correct]"),
    flashcardPrev: document.querySelector("[data-flashcard-prev]"),
    flashcardNext: document.querySelector("[data-flashcard-next]"),
    flashcardPosition: document.querySelector("[data-flashcard-position]"),
    leitnerBoxes: document.querySelector("[data-leitner-boxes]"),
    flashcardHistory: document.querySelector("[data-flashcard-history]"),
  };

  init();

  async function init() {
    elements.randomCount.value = "20";
    applyTheme(settings.theme);
    syncSettingsControls();
    await initSupabase();

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
    elements.loginForms.forEach((form) => form.addEventListener("submit", handleLogin));
    elements.signupForms.forEach((form) => form.addEventListener("submit", handleSignup));
    elements.logoutButtons.forEach((button) => button.addEventListener("click", logoutUser));
    elements.leagueButtons.forEach((button) => {
      button.addEventListener("click", () => startLeagueGame(button.dataset.leagueTopic));
    });
    elements.flashcardTopicButtons.forEach((button) => {
      button.addEventListener("click", () => selectFlashcardTopic(button.dataset.flashcardTopic));
    });
    elements.flashcardCategory.addEventListener("change", () => selectFlashcardCategory(elements.flashcardCategory.value));

    document.querySelector("[data-start-selected]").addEventListener("click", startSelectedMode);
    document.querySelector("[data-start-random]").addEventListener("click", () => startRandomGame());
    document.querySelector("[data-start-all]").addEventListener("click", startAllGame);
    document.querySelector("[data-end-game]").addEventListener("click", endGameFromButton);
    document.querySelector("[data-reset-scores]").addEventListener("click", resetScores);
    document.querySelector("[data-reset-mistakes]").addEventListener("click", resetMistakes);
    document.querySelector("[data-practice-mistakes]").addEventListener("click", startMistakePractice);
    document.querySelector("[data-export-report]").addEventListener("click", exportReport);
    elements.nextQuestion.addEventListener("click", nextQuestion);
    elements.flashcardShow.addEventListener("click", showFlashcardAnswer);
    elements.flashcardWrong.addEventListener("click", () => gradeFlashcard(false));
    elements.flashcardCorrect.addEventListener("click", () => gradeFlashcard(true));
    elements.flashcardPrev.addEventListener("click", () => navigateFlashcard(-1));
    elements.flashcardNext.addEventListener("click", () => navigateFlashcard(1));

    updateTopicSelection();
    updateModeSelection();
    syncSettingsControls();
    updateUserChrome();
    renderDashboard();
    renderIdleGame();
    renderAccount();
    renderLeague();
    renderFlashcards();
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
      nextStore.flashcards = normalizeFlashcardStore(value.flashcards);
      return nextStore;
    }

    if (value && typeof value === "object") {
      nextStore.topics.timing = normalizeTopicStore(value);
      nextStore.flashcards = normalizeFlashcardStore(value.flashcards);
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
    const id = normalizeEmail(user.id || user.email || user.username);
    if (!id || !user.passwordHash || !user.salt) return null;
    return {
      id,
      username: String(user.username || id.split("@")[0] || id).trim() || id,
      email: normalizeEmail(user.email || id),
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
    if (cloudMode) {
      void persistCloudUserState();
      return;
    }

    const index = users.findIndex((user) => user.id === activeUser.id);
    if (index >= 0) {
      users[index] = activeUser;
    } else {
      users.push(activeUser);
    }
    saveUsers();
    saveActiveUserId();
  }

  async function initSupabase() {
    if (!SUPABASE_ENABLED) return;

    try {
      supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });

      const { data } = await supabaseClient.auth.getSession();
      if (data?.session?.user) {
        await setCloudUserFromAuth(data.session.user);
      }

      await refreshCloudLeagueStandings();

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        void handleCloudAuthChange(session?.user || null);
      });
    } catch (error) {
      supabaseClient = null;
      cloudMode = false;
      setAuthStatus(`اتصال Supabase برقرار نشد: ${error.message || "خطای نامشخص"}`, "wrong");
    }
  }

  async function handleCloudAuthChange(user) {
    if (user) {
      await setCloudUserFromAuth(user);
    } else if (cloudMode) {
      cloudMode = false;
      activeUser = null;
      activeUserId = "";
      store = loadStore();
    }
    refreshUserViews();
    renderIdleGame();
  }

  async function setCloudUserFromAuth(authUser) {
    const profile = await ensureCloudProfile(authUser);
    const state = await loadCloudUserState(authUser.id);
    activeUser = {
      id: authUser.id,
      email: authUser.email || profile.email || "",
      username: profile.username || authUser.email || "کاربر",
      createdAt: profile.created_at || authUser.created_at || new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      updatedAt: state.updated_at || "",
      store: normalizeStore(state.store),
      activities: Array.isArray(state.activities) ? state.activities.slice(0, 160) : [],
      leagueResults: await loadCloudUserLeagueResults(authUser.id),
      cloud: true,
    };
    activeUserId = activeUser.id;
    cloudMode = true;
    store = normalizeStore(activeUser.store);
  }

  async function ensureCloudProfile(authUser) {
    const metadataUsername = authUser.user_metadata?.username;
    const fallbackUsername = authUser.email ? authUser.email.split("@")[0] : "user";
    const desiredUsername = String(metadataUsername || fallbackUsername).trim();

    const { data, error } = await supabaseClient
      .from("profiles")
      .select("user_id, username, email, created_at, updated_at")
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (data && !error) return data;

    const { data: inserted, error: insertError } = await supabaseClient
      .from("profiles")
      .upsert(
        {
          user_id: authUser.id,
          username: desiredUsername,
          email: authUser.email || "",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select("user_id, username, email, created_at, updated_at")
      .single();

    if (insertError) throw insertError;
    return inserted;
  }

  async function loadCloudUserState(userId) {
    const { data, error } = await supabaseClient
      .from("user_states")
      .select("store, activities, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (data && !error) return data;

    const empty = {
      user_id: userId,
      store: makeEmptyStore(),
      activities: [],
      updated_at: new Date().toISOString(),
    };
    await supabaseClient.from("user_states").upsert(empty, { onConflict: "user_id" });
    return empty;
  }

  async function persistCloudUserState() {
    if (!activeUser || !supabaseClient) return;
    activeUser.store = store;
    activeUser.updatedAt = new Date().toISOString();
    await supabaseClient.from("user_states").upsert(
      {
        user_id: activeUser.id,
        store: activeUser.store,
        activities: activeUser.activities,
        updated_at: activeUser.updatedAt,
      },
      { onConflict: "user_id" }
    );
  }

  function makeEmptyStore() {
    return {
      topics: Object.fromEntries(TOPIC_IDS.map((topicId) => [topicId, makeEmptyTopicStore()])),
      flashcards: makeEmptyFlashcardStore(),
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

  function makeEmptyFlashcardStore() {
    return {
      topics: Object.fromEntries(
        FLASHCARD_TOPIC_IDS.map((topicId) => [topicId, makeEmptyFlashcardTopicStore()])
      ),
    };
  }

  function makeEmptyFlashcardTopicStore() {
    return {
      cards: {},
      reviewed: 0,
      correct: 0,
      wrong: 0,
      history: [],
    };
  }

  function normalizeFlashcardStore(value) {
    const next = makeEmptyFlashcardStore();
    if (!value || typeof value !== "object") return next;

    const sourceTopics = value.topics && typeof value.topics === "object" ? value.topics : value;
    FLASHCARD_TOPIC_IDS.forEach((topicId) => {
      next.topics[topicId] = normalizeFlashcardTopicStore(sourceTopics[topicId]);
    });
    return next;
  }

  function normalizeFlashcardTopicStore(value) {
    const next = makeEmptyFlashcardTopicStore();
    if (!value || typeof value !== "object") return next;

    next.reviewed = Number(value.reviewed || 0);
    next.correct = Number(value.correct || 0);
    next.wrong = Number(value.wrong || 0);
    next.history = Array.isArray(value.history) ? value.history.slice(0, 80) : [];

    if (value.cards && typeof value.cards === "object") {
      Object.entries(value.cards).forEach(([key, card]) => {
        const normalized = normalizeFlashcardCard(card);
        if (normalized) next.cards[key] = normalized;
      });
    }

    return next;
  }

  function normalizeFlashcardCard(card) {
    if (!card || typeof card !== "object") return null;
    return {
      key: String(card.key || ""),
      topicId: String(card.topicId || ""),
      drugId: String(card.drugId || ""),
      box: clamp(Number(card.box || 1), 1, LEITNER_BOX_COUNT),
      dueAt: String(card.dueAt || ""),
      reviewed: Number(card.reviewed || 0),
      correct: Number(card.correct || 0),
      wrong: Number(card.wrong || 0),
      lastGrade: card.lastGrade === "correct" ? "correct" : card.lastGrade === "wrong" ? "wrong" : "",
      lastAt: String(card.lastAt || ""),
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
    const form = event.currentTarget;
    const username = form.querySelector("[data-signup-username]")?.value.trim() || "";
    const email = normalizeEmail(form.querySelector("[data-signup-email]")?.value);
    const password = form.querySelector("[data-signup-password]")?.value || "";
    const id = normalizeUsername(username);

    if (id.length < 2 || !isValidEmail(email) || password.length < 6) {
      setAuthStatus("نام کاربری، ایمیل معتبر و پسورد حداقل ۶ کاراکتر لازم است.", "wrong");
      return;
    }

    if (SUPABASE_ENABLED) {
      await signupCloudUser(username, email, password);
      return;
    }

    if (
      users.some(
        (user) => user.id === email || user.email === email || normalizeUsername(user.username) === id
      )
    ) {
      setAuthStatus("این نام کاربری قبلا ساخته شده است.", "wrong");
      return;
    }

    const passwordMethod = canUseSecureHash() ? "sha256" : "fallback";
    const salt = makeSalt();
    const passwordHash = await makePasswordHash(password, salt, passwordMethod);
    const now = new Date().toISOString();
    activeUser = {
      id: email,
      username,
      email,
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
    activeUserId = email;
    store = normalizeStore(activeUser.store);
    addActivity({ type: "account", label: "ساخت کاربر", detail: activeUser.username }, { persist: false });
    persistActiveUser();
    clearAuthForms();
    setAuthStatus("کاربر ساخته و وارد شد.", "correct");
    refreshUserViews();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = normalizeEmail(form.querySelector("[data-login-email]")?.value);
    const password = form.querySelector("[data-login-password]")?.value || "";

    if (SUPABASE_ENABLED) {
      await loginCloudUser(email, password);
      return;
    }

    const user = users.find(
      (item) => item.id === email || item.email === email || normalizeUsername(item.username) === email
    );

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

  async function signupCloudUser(username, email, password) {
    setAuthStatus("در حال ساخت کاربر...", "");
    let data;
    let error;
    try {
      const response = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { username },
        },
      });
      data = response.data;
      error = response.error;
    } catch (requestError) {
      setAuthStatus(requestError.message || "اتصال به Supabase انجام نشد.", "wrong");
      return;
    }

    if (error) {
      setAuthStatus(error.message || "ساخت کاربر انجام نشد.", "wrong");
      return;
    }

    if (!data.session && data.user) {
      clearAuthForms();
      setAuthStatus("کاربر ساخته شد. اگر تایید ایمیل فعال است، ایمیل را تایید کن و سپس وارد شو.", "correct");
      return;
    }

    if (data.user) {
      await setCloudUserFromAuth(data.user);
      await refreshCloudLeagueStandings();
      addActivity({ type: "account", label: "ساخت کاربر", detail: activeUser.username }, { persist: false });
      await persistCloudUserState();
      clearAuthForms();
      setAuthStatus("کاربر ساخته و وارد شد.", "correct");
      refreshUserViews();
    }
  }

  async function loginCloudUser(email, password) {
    setAuthStatus("در حال ورود...", "");
    let data;
    let error;
    try {
      const response = await supabaseClient.auth.signInWithPassword({ email, password });
      data = response.data;
      error = response.error;
    } catch (requestError) {
      setAuthStatus(requestError.message || "اتصال به Supabase انجام نشد.", "wrong");
      return;
    }

    if (error) {
      setAuthStatus(error.message || "ورود انجام نشد.", "wrong");
      return;
    }

    if (data.user) {
      await setCloudUserFromAuth(data.user);
      await refreshCloudLeagueStandings();
      addActivity({ type: "account", label: "ورود", detail: activeUser.username }, { persist: false });
      await persistCloudUserState();
      clearAuthForms();
      setAuthStatus("ورود انجام شد.", "correct");
      refreshUserViews();
    }
  }

  function logoutUser(event) {
    if (!activeUser) return;
    const returnView = event?.currentTarget?.closest("#dashboard") ? "dashboard" : "account";
    if (cloudMode && supabaseClient) {
      void supabaseClient.auth.signOut();
    }
    cloudMode = false;
    stopQuestionTimer();
    quiz = null;
    activeUser = null;
    activeUserId = "";
    store = loadStore();
    saveActiveUserId();
    setAuthStatus("از حساب خارج شدید.", "");
    refreshUserViews();
    renderIdleGame();
    navigate(returnView);
  }

  function refreshUserViews() {
    updateUserChrome();
    renderDashboard();
    renderMistakes();
    renderScores();
    renderAccount();
    renderLeague();
    renderFlashcards();
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
    if (viewId === "flashcards") renderFlashcards();
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

  function makeGenericAliasSignatureMap(drugs) {
    const aliasTargets = new Map();
    const aliases = new Map();
    const byBrand = groupTopicDrugsByBrand(drugs);

    Object.entries(STATIC_GENERIC_SIGNATURE_ALIASES).forEach(([source, target]) => {
      const sourceSignature = getStaticGenericSignature(source);
      const targetSignature = getStaticGenericSignature(target);
      if (sourceSignature && targetSignature) aliases.set(sourceSignature, targetSignature);
    });

    byBrand.forEach((group) => {
      const finalRows = group.filter(isFinalTopicDrugSource);
      if (!finalRows.length) return;

      const targetSignature = getStaticGenericSignature(
        chooseBestTopicDrugRecord(finalRows).genericName
      );
      if (!targetSignature) return;

      group
        .filter((drug) => !isFinalTopicDrugSource(drug))
        .forEach((drug) => {
          const sourceSignature = getStaticGenericSignature(drug.genericName);
          if (!sourceSignature || sourceSignature === targetSignature) return;
          if (!aliasTargets.has(sourceSignature)) aliasTargets.set(sourceSignature, new Set());
          aliasTargets.get(sourceSignature).add(targetSignature);
        });
    });

    aliasTargets.forEach((targets, sourceSignature) => {
      if (targets.size === 1) aliases.set(sourceSignature, [...targets][0]);
    });

    return aliases;
  }

  function makeBrandGenericDrugRows(drugs) {
    const normalizedRows = [];
    const byBrand = groupTopicDrugsByBrand(drugs);

    byBrand.forEach((group, brandSignature) => {
      if (BRAND_GENERIC_EXCLUDED_BRAND_SIGNATURES.has(brandSignature)) return;
      const candidates = group.filter((drug) => isUsableAnswer(drug.genericName));
      if (!candidates.length) return;

      const finalRows = candidates.filter(isFinalTopicDrugSource);
      const genericSignatures = new Set(
        candidates.map((drug) => getGenericEquivalentSignature(drug.genericName)).filter(Boolean)
      );

      if (!finalRows.length && genericSignatures.size > 1) return;

      const pool = finalRows.length ? finalRows : candidates;
      const selected = chooseBestTopicDrugRecord(pool);
      const selectedSignature = getGenericEquivalentSignature(selected.genericName);
      const equivalentRows = candidates
        .filter((drug) => getGenericEquivalentSignature(drug.genericName) === selectedSignature)
        .sort((a, b) => scoreTopicDrugRecord(b) - scoreTopicDrugRecord(a));
      const answerSource = equivalentRows.find((drug) => hasPersianText(drug.genericName)) || selected;

      normalizedRows.push({
        ...selected,
        genericName: answerSource.genericName,
      });
    });

    return normalizedRows;
  }

  function groupTopicDrugsByBrand(drugs) {
    const byBrand = new Map();
    drugs.forEach((drug) => {
      const brandSignature = getBrandSignature(drug.brandName);
      if (!brandSignature) return;
      if (!byBrand.has(brandSignature)) byBrand.set(brandSignature, []);
      byBrand.get(brandSignature).push(drug);
    });
    return byBrand;
  }

  function chooseBestTopicDrugRecord(drugs) {
    return [...drugs].sort((a, b) => scoreTopicDrugRecord(b) - scoreTopicDrugRecord(a))[0];
  }

  function scoreTopicDrugRecord(drug) {
    const sourceScore = isFinalTopicDrugSource(drug) ? 1000000 : 0;
    const languageScore = hasPersianText(drug.genericName) ? 5000 : 0;
    const detailScore = [
      "indication",
      "indicationAnswer",
      "sideEffects",
      "sideEffectsAnswer",
      "drugClassification",
      "dosageForm",
      "notes",
    ].reduce((total, key) => total + normalizeOptionText(drug[key]).length, 0);

    return sourceScore + languageScore + detailScore;
  }

  function isFinalTopicDrugSource(drug) {
    return !normalizeOptionText(drug.sourceTopic) && !normalizeOptionText(drug.sourceFile);
  }

  function getBrandSignature(brandName) {
    return getOptionSignature(brandName);
  }

  function getStaticGenericSignature(genericName) {
    return getOptionSignature(genericName);
  }

  function getGenericEquivalentSignature(genericName) {
    const signature = getStaticGenericSignature(genericName);
    return GENERIC_ALIAS_SIGNATURES.get(signature) || signature;
  }

  function hasPersianText(value) {
    return /[آ-ی]/.test(String(value || ""));
  }

  function getAnswerSignature(topic, option) {
    return topic.id === "brandGeneric"
      ? getGenericEquivalentSignature(option)
      : getOptionSignature(option);
  }

  function makeOptionPool(topic) {
    const seen = new Set();
    return topic.data
      .map((drug) => topic.getAnswer(drug))
      .filter(isUsableAnswer)
      .filter((option) => {
        const signature = getAnswerSignature(topic, option);
        if (!signature || seen.has(signature)) return false;
        seen.add(signature);
        return true;
      });
  }

  function buildOptions(drug, topic) {
    const correctAnswer = topic.getAnswer(drug);
    const correctSignature = getAnswerSignature(topic, correctAnswer);
    const seen = new Set([correctSignature]);
    const distractors = [];

    shuffle(optionPools[topic.id]).forEach((option) => {
      const signature = getAnswerSignature(topic, option);
      if (!signature || seen.has(signature)) return;
      seen.add(signature);
      distractors.push(option);
    });

    return shuffle([correctAnswer, ...distractors.slice(0, 3)]).slice(0, 4);
  }

  function isUsableAnswer(option) {
    const value = normalizeOptionText(option);
    return Boolean(value) && !INVALID_ANSWER_OPTIONS.has(value);
  }

  function getOptionSignature(option) {
    const value = normalizeOptionText(option);
    const key = value
      .replace(/[يى]/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/[\u200c\u200e\u200f\u202a-\u202e]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const compactKey = key.replace(/[^0-9a-zA-Zآ-ی]+/g, "");

    if (!compactKey || INVALID_ANSWER_OPTIONS.has(value)) return "";
    if (compactKey === "gi" || compactKey.includes("مشکلاتگوارشی") || compactKey === "عوارضگوارشی") {
      return "gi";
    }
    if (compactKey.includes("خوابالود") || compactKey.includes("خوابالو")) return "sleepiness";
    if (compactKey.includes("سرگیجه")) return "dizziness";
    if (compactKey.includes("تهوع") && compactKey.includes("استفراغ")) return "nausea-vomiting";
    if (compactKey.includes("تهوع")) return "nausea";
    if (compactKey.includes("استفراغ")) return "vomiting";
    if (compactKey.includes("اسهال")) return "diarrhea";
    if (compactKey.includes("یبوست")) return "constipation";
    return compactKey;
  }

  function normalizeOptionText(option) {
    return String(option || "")
      .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
      .replace(/\s+/g, " ")
      .trim();
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
    renderDashboardAuth();
  }

  function renderDashboardAuth() {
    if (!elements.dashboardAuthPanel) return;
    const isLoggedIn = Boolean(activeUser);
    elements.dashboardAuthGuest.hidden = isLoggedIn;
    elements.dashboardAuthProfile.hidden = !isLoggedIn;

    if (elements.dashboardUserProfile) clearChildren(elements.dashboardUserProfile);
    if (!isLoggedIn) return;

    const totalGames = TOPIC_IDS.reduce((sum, topicId) => sum + getTopicStore(topicId).games.length, 0);
    const totalFlashcards = FLASHCARD_TOPIC_IDS.reduce(
      (sum, topicId) => sum + getFlashcardTopicStore(topicId).reviewed,
      0
    );
    const bestLeague = getBestLeagueResult(activeUser);
    elements.dashboardUserProfile.append(
      makeSummaryTile("کاربر", activeUser.username),
      makeSummaryTile("بازی‌ها", formatNumber(totalGames)),
      makeSummaryTile("فلش‌کارت", formatNumber(totalFlashcards)),
      makeSummaryTile("بهترین لیگ", bestLeague ? formatDecimal(bestLeague.leagueRating) : "0")
    );
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
    const totalFlashcards = FLASHCARD_TOPIC_IDS.reduce(
      (sum, topicId) => sum + getFlashcardTopicStore(topicId).reviewed,
      0
    );
    const bestLeague = getBestLeagueResult(activeUser);

    elements.userProfile.append(
      makeSummaryTile("نام کاربری", activeUser.username),
      makeSummaryTile("بازی‌ها", formatNumber(totalGames)),
      makeSummaryTile("خطاها", formatNumber(totalMistakes)),
      makeSummaryTile("فلش‌کارت", formatNumber(totalFlashcards)),
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

  function selectFlashcardTopic(topicId) {
    if (!FLASHCARD_TOPIC_IDS.includes(topicId)) return;
    selectedFlashcardTopicId = topicId;
    selectedFlashcardCategory = "";
    selectedLeitnerBox = 0;
    flashcardSession = {
      topicId,
      current: null,
      revealed: false,
    };
    renderFlashcards();
  }

  function selectFlashcardCategory(category) {
    selectedFlashcardCategory = category || "";
    selectedLeitnerBox = 0;
    flashcardSession = {
      topicId: selectedFlashcardTopicId,
      current: null,
      revealed: false,
    };
    renderFlashcards();
  }

  function renderFlashcards() {
    if (!elements.flashcardFront) return;

    const topic = getFlashcardTopic();
    syncFlashcardCategoryOptions(topic.id);
    const deck = getFlashcardDeck(topic.id);
    const queueCards = getFlashcardQueue(topic.id, deck);
    const boxedCards = getBoxedFlashcards(topic.id, deck);
    const hasCurrent =
      flashcardSession.topicId === topic.id &&
      flashcardSession.current &&
      queueCards.some((card) => card.key === flashcardSession.current.key);

    if (!hasCurrent) {
      setActiveFlashcard(queueCards[0] || null, topic.id);
    }

    const topicStore = getFlashcardTopicStore(topic.id);
    const activeCard = flashcardSession.topicId === topic.id ? flashcardSession.current : null;
    const activeState = activeCard ? getFlashcardCardState(topic.id, activeCard.drugId, activeCard.key) : null;
    const accuracy = topicStore.reviewed ? Math.round((topicStore.correct / topicStore.reviewed) * 100) : 0;

    elements.flashcardTopicButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.flashcardTopic === topic.id);
    });
    elements.flashcardTopicLabel.textContent = topic.label;
    elements.flashcardCategoryCount.textContent = `${formatNumber(deck.length)} کارت`;
    elements.flashcardDue.textContent = formatNumber(boxedCards.length);
    elements.flashcardCurrentBox.textContent = activeState?.inBox ? formatNumber(activeState.box) : "-";
    elements.flashcardReviewed.textContent = formatNumber(topicStore.reviewed);
    elements.flashcardAccuracy.textContent = `${formatNumber(accuracy)}٪`;
    elements.flashcardCard.classList.toggle("is-revealed", Boolean(activeCard && flashcardSession.revealed));
    renderFlashcardNavigation(queueCards, activeCard);

    if (!activeCard) {
      elements.flashcardFrontLabel.textContent = "مرور";
      elements.flashcardFront.textContent = deck.length
        ? selectedLeitnerBox
          ? `جعبه ${formatNumber(selectedLeitnerBox)} خالی است.`
          : "کارت قابل مرور وجود ندارد."
        : "برای این موضوع کارت قابل مرور وجود ندارد.";
      elements.flashcardSubtitle.textContent = deck.length
        ? "از جعبه‌ها یک مورد را انتخاب کنید یا موضوع دیگری را تمرین کنید."
        : "داده‌های این موضوع هنوز پاسخ معتبر کافی ندارند.";
      elements.flashcardAnswer.hidden = true;
      elements.flashcardBack.textContent = "";
      elements.flashcardShow.textContent = "نمایش پاسخ";
      elements.flashcardShow.disabled = true;
      elements.flashcardWrong.disabled = true;
      elements.flashcardCorrect.disabled = true;
    } else {
      elements.flashcardFrontLabel.textContent = activeCard.frontLabel;
      elements.flashcardFront.textContent = activeCard.front;
      elements.flashcardSubtitle.textContent = activeCard.subtitle;
      elements.flashcardBack.textContent = activeCard.back;
      elements.flashcardAnswer.hidden = false;
      elements.flashcardShow.disabled = flashcardSession.revealed;
      elements.flashcardShow.textContent = flashcardSession.revealed ? "پاسخ نمایش داده شد" : "نمایش پاسخ";
      elements.flashcardWrong.disabled = !flashcardSession.revealed;
      elements.flashcardCorrect.disabled = !flashcardSession.revealed;
    }

    renderLeitnerBoxes(topic.id, deck);
    renderFlashcardHistory(topic.id, deck);
    updateUserChrome();
  }

  function showFlashcardAnswer() {
    if (!flashcardSession.current) return;
    flashcardSession.revealed = true;
    renderFlashcards();
  }

  function navigateFlashcard(direction) {
    const topic = getFlashcardTopic();
    const deck = getFlashcardDeck(topic.id);
    const queueCards = getFlashcardQueue(topic.id, deck);
    const activeCard = flashcardSession.topicId === topic.id ? flashcardSession.current : null;
    const targetCard = pickAdjacentFlashcard(queueCards, activeCard?.key || "", direction);
    setActiveFlashcard(targetCard, topic.id);
    renderFlashcards();
  }

  function gradeFlashcard(isKnown) {
    const activeCard = flashcardSession.current;
    if (!activeCard || !flashcardSession.revealed) return;

    const topic = getFlashcardTopic(activeCard.topicId);
    const topicStore = getFlashcardTopicStore(topic.id);
    const previous = getFlashcardCardState(topic.id, activeCard.drugId, activeCard.key);
    const nowIso = new Date().toISOString();
    const currentBox = previous.inBox ? previous.box : 0;
    const nextBox = isKnown
      ? Math.max(0, currentBox - 1)
      : Math.min(currentBox + 1 || 1, LEITNER_BOX_COUNT);
    const removedFromBox = isKnown && previous.inBox && currentBox <= 1;
    const shouldStoreCard = !isKnown || previous.inBox;
    const nextState = {
      ...previous,
      key: activeCard.key,
      topicId: topic.id,
      drugId: activeCard.drugId,
      box: nextBox || 1,
      dueAt: nowIso,
      reviewed: previous.reviewed + 1,
      correct: previous.correct + (isKnown ? 1 : 0),
      wrong: previous.wrong + (isKnown ? 0 : 1),
      lastGrade: isKnown ? "correct" : "wrong",
      lastAt: nowIso,
    };

    if (removedFromBox) {
      delete topicStore.cards[activeCard.key];
    } else if (shouldStoreCard) {
      topicStore.cards[activeCard.key] = nextState;
    } else {
      delete topicStore.cards[activeCard.key];
    }
    topicStore.reviewed += 1;
    topicStore.correct += isKnown ? 1 : 0;
    topicStore.wrong += isKnown ? 0 : 1;
    topicStore.history.unshift({
      id: makeId(),
      key: activeCard.key,
      drugId: activeCard.drugId,
      title: activeCard.front,
      answer: activeCard.back,
      grade: isKnown ? "correct" : "wrong",
      box: nextBox || 0,
      dueAt: nowIso,
      createdAt: nowIso,
    });
    topicStore.history = topicStore.history.slice(0, 80);

    addActivity({
      type: "flashcard",
      label: isKnown
        ? !previous.inBox
          ? "مرور موفق فلش‌کارت"
          : removedFromBox
          ? "حذف از جعبه خطا"
          : "بازگشت فلش‌کارت به جعبه قبلی"
        : "انتقال فلش‌کارت به جعبه بعدی",
      topicLabel: topic.label,
      detail: activeCard.front,
    });
    saveStore();

    setActiveFlashcard(pickNextFlashcard(topic.id, activeCard.key), topic.id);
    renderFlashcards();
  }

  function setActiveFlashcard(card, topicId = selectedFlashcardTopicId) {
    flashcardSession = {
      topicId,
      current: card,
      revealed: false,
    };
  }

  function pickNextFlashcard(topicId, excludeKey = "") {
    const deck = getFlashcardDeck(topicId);
    if (selectedLeitnerBox) {
      const selectedBoxCards = getBoxedFlashcards(topicId, deck).filter(
        (card) => card.state.box === selectedLeitnerBox
      );
      return selectedBoxCards.find((card) => card.key !== excludeKey) || selectedBoxCards[0] || null;
    }
    return pickNextDeckFlashcard(deck, excludeKey);
  }

  function pickNextDeckFlashcard(deck, currentKey = "") {
    if (!deck.length) return null;
    const currentIndex = deck.findIndex((card) => card.key === currentKey);
    if (currentIndex < 0) return deck[0];
    return deck[(currentIndex + 1) % deck.length];
  }

  function pickAdjacentFlashcard(cards, currentKey = "", direction = 1) {
    if (!cards.length) return null;
    const currentIndex = cards.findIndex((card) => card.key === currentKey);
    if (currentIndex < 0) return cards[0];
    const nextIndex = (currentIndex + direction + cards.length) % cards.length;
    return cards[nextIndex];
  }

  function renderFlashcardNavigation(cards, activeCard) {
    const total = cards.length;
    const activeIndex = activeCard ? cards.findIndex((card) => card.key === activeCard.key) : -1;
    const position = activeIndex >= 0 ? activeIndex + 1 : 0;
    const canMove = total > 1 && activeIndex >= 0;

    elements.flashcardPosition.textContent = `${formatNumber(position)} از ${formatNumber(total)}`;
    elements.flashcardPrev.disabled = !canMove;
    elements.flashcardNext.disabled = !canMove;
  }

  function getFlashcardDeck(topicId) {
    const topic = getFlashcardTopic(topicId);
    const filteredDrugs = topic.data.filter((drug) => isDrugInSelectedFlashcardCategory(drug));
    return normalizeFlashcardDrugsForTopic(topic, filteredDrugs)
      .map((drug) => makeFlashcardModel(topic, drug))
      .filter(Boolean);
  }

  function isDrugInSelectedFlashcardCategory(drug) {
    if (!selectedFlashcardCategory) return true;
    return getDrugCategory(drug) === selectedFlashcardCategory;
  }

  function syncFlashcardCategoryOptions(topicId) {
    const select = elements.flashcardCategory;
    const topic = getFlashcardTopic(topicId);
    const categories = getFlashcardCategories(topic);
    const hasSelectedCategory = categories.some((category) => category.value === selectedFlashcardCategory);

    if (selectedFlashcardCategory && !hasSelectedCategory) {
      selectedFlashcardCategory = "";
      selectedLeitnerBox = 0;
      setActiveFlashcard(null, topic.id);
    }

    clearChildren(select);
    const allOption = document.createElement("option");
    allOption.value = "";
    const totalCards = countFlashcardCardsForTopic(topic);
    allOption.textContent = `همه دسته‌ها (${formatNumber(totalCards)})`;
    select.append(allOption);

    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.value;
      option.textContent = `${category.value} (${formatNumber(category.count)})`;
      select.append(option);
    });

    select.value = selectedFlashcardCategory;
  }

  function getFlashcardCategories(topic) {
    const categories = new Map();

    topic.data.forEach((drug) => {
      const model = makeFlashcardModel(topic, drug);
      if (!model) return;
      const category = getDrugCategory(drug);
      if (!category) return;

      if (topic.id === "brandGeneric") {
        categories.set(category, (categories.get(category) || 0) + 1);
        return;
      }

      const generics = categories.get(category) || new Set();
      generics.add(getGenericFlashcardSignature(drug.genericName));
      categories.set(category, generics);
    });

    return [...categories.entries()]
      .map(([value, count]) => ({
        value,
        count: count instanceof Set ? count.size : count,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  function countFlashcardCardsForTopic(topic) {
    return normalizeFlashcardDrugsForTopic(topic, topic.data)
      .map((drug) => makeFlashcardModel(topic, drug))
      .filter(Boolean).length;
  }

  function getDrugCategory(drug) {
    const sourceTopic = normalizeOptionText(drug?.sourceTopic || drug?.sourceFile?.replace(/\.docx$/i, ""));
    if (sourceTopic) return getSourceTopicLabel(sourceTopic);

    const classification = normalizeOptionText(drug?.drugClassification);
    return getCategoryFromClassification(classification);
  }

  function getSourceTopicLabel(sourceTopic) {
    const key = sourceTopic.toLowerCase();
    const labels = {
      "cardiovascular + dyslipidemia": "قلب، فشار خون و چربی خون",
      "cns-1": "داروهای عصبی CNS-1",
      "cns-2": "داروهای عصبی CNS-2",
      infection: "ضد عفونت‌ها",
      endo: "غدد، دیابت و هورمون‌ها",
      gi: "گوارش",
      respiratory: "تنفسی",
      sedative: "خواب‌آورها و آرام‌بخش‌ها",
    };
    return labels[key] || sourceTopic;
  }

  function getCategoryFromClassification(classification) {
    const value = classification.toLowerCase();
    if (!value) return "سایر/بدون دسته کلی";

    if (/(ace inhibitor|arb|angiotensin|beta|calcium channel|diuretic|antihypertensive|antiplatelet|anticoagulant|thrombolytic|statin|lipid|p2y12|nitrate|antiarrhythmic)/i.test(value)) {
      return "قلب، فشار خون و چربی خون";
    }
    if (/(benzodiazepine|ssri|snri|antidepressant|antipsychotic|antiepileptic|anticonvulsant|hypnotic|sedative|cns|dopamine|parkinson|migraine|opioid|anxiolytic)/i.test(value)) {
      return "داروهای عصبی CNS";
    }
    if (/(antibiotic|antifungal|antiviral|anthelmintic|antimicrobial|macrolide|quinolone|penicillin|cephalosporin|azole|polyene)/i.test(value)) {
      return "ضد عفونت‌ها";
    }
    if (/(antidiabetic|insulin|biguanide|thyroid|hormone|corticosteroid|glucocorticoid|bisphosphonate|osteoporosis|somatostatin|growth hormone)/i.test(value)) {
      return "غدد، دیابت و هورمون‌ها";
    }
    if (/(h2 receptor|ppi|proton pump|antiemetic|prokinetic|laxative|antacid|pancreatic|gastro|ibs)/i.test(value)) {
      return "گوارش";
    }
    if (/(bronchodilator|inhaled|asthma|copd|respiratory|leukotriene|anticholinergic)/i.test(value)) {
      return "تنفسی";
    }
    if (/(immunosuppressant|biologic|monoclonal|anticancer|chemotherapy|antineoplastic|rheumatologic)/i.test(value)) {
      return "ایمنی، روماتولوژی و سرطان";
    }
    if (/(dermatologic|retinoid|acne|psoriasis|topical)/i.test(value)) {
      return "پوست";
    }
    return "سایر/بدون دسته کلی";
  }

  function normalizeFlashcardDrugsForTopic(topic, drugs) {
    if (topic.id === "brandGeneric") return drugs;

    const byGeneric = new Map();
    drugs.forEach((drug) => {
      const genericKey = getGenericFlashcardSignature(drug.genericName);
      if (!genericKey) return;
      const previous = byGeneric.get(genericKey);
      if (!previous || scoreGenericFlashcardSource(topic.id, drug) > scoreGenericFlashcardSource(topic.id, previous)) {
        byGeneric.set(genericKey, drug);
      }
    });
    return [...byGeneric.values()];
  }

  function scoreGenericFlashcardSource(topicId, drug) {
    const fullText = topicId === "indication" ? drug.indication : drug.sideEffects;
    const answer = topicId === "indication" ? drug.indicationAnswer : drug.sideEffectsAnswer;
    return normalizeOptionText(fullText || "").length * 2 + normalizeOptionText(answer || "").length;
  }

  function getGenericFlashcardSignature(genericName) {
    return getGenericEquivalentSignature(genericName);
  }

  function makeFlashcardModel(topic, drug) {
    const answer = topic.getAnswer(drug);
    if (!drug?.id || !isUsableAnswer(answer)) return null;

    const brandName = drug.brandName || topic.getName(drug);
    const genericName = drug.genericName || "";
    const genericKey = getGenericFlashcardSignature(genericName);
    const key =
      topic.id === "brandGeneric"
        ? makeFlashcardKey(topic.id, drug.id)
        : makeFlashcardKey(topic.id, `generic:${genericKey}`);

    if (topic.id === "brandGeneric") {
      return {
        key,
        topicId: topic.id,
        drugId: drug.id,
        frontLabel: "نام تجاری",
        front: `نام ژنریک ${brandName} چیست؟`,
        subtitle: drug.drugClassification || "",
        back: answer,
      };
    }

    if (topic.id === "indication") {
      if (!genericName || !genericKey) return null;
      return {
        key,
        topicId: topic.id,
        drugId: `generic:${genericKey}`,
        frontLabel: "اندیکاسیون",
        front: `کاربرد اصلی ${genericName} چیست؟`,
        subtitle: getDrugCategory(drug),
        back: getFullFlashcardAnswer(topic.id, drug, answer),
      };
    }

    if (topic.id === "sideEffects") {
      if (!genericName || !genericKey) return null;
      return {
        key,
        topicId: topic.id,
        drugId: `generic:${genericKey}`,
        frontLabel: "عوارض",
        front: `عوارض مهم ${genericName} چیست؟`,
        subtitle: getDrugCategory(drug),
        back: getFullFlashcardAnswer(topic.id, drug, answer),
      };
    }

    return null;
  }

  function getFlashcardQueue(topicId, deck = getFlashcardDeck(topicId)) {
    if (selectedLeitnerBox) {
      return getBoxedFlashcards(topicId, deck).filter((card) => card.state.box === selectedLeitnerBox);
    }

    return deck.map((card) => ({
      ...card,
      state: getFlashcardCardState(topicId, card.drugId, card.key),
    }));
  }

  function getFullFlashcardAnswer(topicId, drug, fallback) {
    const fullValue =
      topicId === "indication"
        ? drug.indication
        : topicId === "sideEffects"
        ? drug.sideEffects
        : "";
    return makeReadableFlashcardAnswer(fullValue || fallback, fallback);
  }

  function makeReadableFlashcardAnswer(value, fallback) {
    const items = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split(/\n|[؛;]/)
      .flatMap(splitLongFlashcardItem)
      .map(cleanFlashcardItem)
      .filter(Boolean)
      .filter(uniqueByOptionSignature)
      .slice(0, 10);

    if (items.length) return items.join("، ");
    return normalizeOptionText(fallback);
  }

  function splitLongFlashcardItem(value) {
    const text = normalizeOptionText(value);
    if (text.length <= 80) return [text];
    return text.split(/\s،\s|,\s/).map((item) => item.trim());
  }

  function cleanFlashcardItem(value) {
    let text = normalizeOptionText(value)
      .replace(/^[\d۰-۹]+[.)-]?\s*/, "")
      .replace(/^[•\-–—*]\s*/, "")
      .replace(/بیماری\s*IIH/g, "بیماری IIH")
      .replace(/^فرم\s+خوراکی\s+(?:آن|ان)\s+برای\s+(.+)$/i, "$1 (فرم خوراکی)")
      .trim();

    if (!text || /^\([^)]*\)$/.test(text)) return "";
    if (/^[A-Za-z][A-Za-z0-9 -]*\s*:/.test(text)) return "";
    if (/^(عوارض مهم|مشابه مابقی|سایر کاربرد|کشورها)\b/.test(text)) return "";

    text = text
      .replace(/\(([^)]*)\)/g, (_match, inner) => {
        const note = normalizeOptionText(inner);
        if (!note || /خط اول نیست|به هیچ عنوان|off-?label|کشورها|طبق پروتکل|در کنار/.test(note)) return "";
        return note.length <= 32 ? `(${note})` : "";
      })
      .replace(/\s*(?:به علت|بدلیل|به همین خاطر|در دوز|برای مسمومیت|در افرادی)\s+.+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text || /^\([^)]*\)$/.test(text)) return "";
    if (text.length > 95) {
      text = text.split(/\s،\s|,\s|\. /)[0].trim();
    }
    return text;
  }

  function uniqueByOptionSignature(value, index, array) {
    const signature = getOptionSignature(value);
    return Boolean(signature) && array.findIndex((item) => getOptionSignature(item) === signature) === index;
  }

  function getBoxedFlashcards(topicId, deck = getFlashcardDeck(topicId)) {
    return deck
      .map((card) => ({
        ...card,
        state: getFlashcardCardState(topicId, card.drugId, card.key),
      }))
      .filter((card) => card.state.inBox)
      .sort(compareFlashcards);
  }

  function compareFlashcards(a, b) {
    if ((b.state.box || 0) !== (a.state.box || 0)) return (b.state.box || 0) - (a.state.box || 0);
    if ((b.state.wrong || 0) !== (a.state.wrong || 0)) return (b.state.wrong || 0) - (a.state.wrong || 0);
    return Number(new Date(a.state.lastAt || 0)) - Number(new Date(b.state.lastAt || 0));
  }

  function renderLeitnerBoxes(topicId, deck) {
    clearChildren(elements.leitnerBoxes);
    const boxes = Array.from({ length: LEITNER_BOX_COUNT }, () => ({ total: 0, wrong: 0 }));

    deck.forEach((card) => {
      const state = getFlashcardCardState(topicId, card.drugId, card.key);
      if (!state.inBox) return;
      const boxIndex = clamp(Number(state.box || 1), 1, LEITNER_BOX_COUNT) - 1;
      boxes[boxIndex].total += 1;
      boxes[boxIndex].wrong += state.wrong || 0;
    });

    boxes.forEach((box, index) => {
      const boxNumber = index + 1;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "leitner-box";
      card.classList.toggle("is-active", selectedLeitnerBox === boxNumber);
      card.addEventListener("click", () => toggleLeitnerBox(boxNumber));

      const title = document.createElement("strong");
      title.textContent = `جعبه ${formatNumber(boxNumber)}`;
      const label = document.createElement("span");
      label.textContent = LEITNER_BOX_LABELS[index];
      const stats = document.createElement("small");
      stats.textContent = `${formatNumber(box.total)} کارت | ${formatNumber(box.wrong)} خطا`;
      card.append(title, label, stats);
      elements.leitnerBoxes.append(card);
    });
  }

  function toggleLeitnerBox(boxNumber) {
    selectedLeitnerBox = selectedLeitnerBox === boxNumber ? 0 : boxNumber;
    const topic = getFlashcardTopic();
    setActiveFlashcard(pickNextFlashcard(topic.id), topic.id);
    renderFlashcards();
  }

  function renderFlashcardHistory(topicId, deck) {
    clearChildren(elements.flashcardHistory);
    const boxedCards = getBoxedFlashcards(topicId, deck);
    const visibleCards = selectedLeitnerBox
      ? boxedCards.filter((card) => card.state.box === selectedLeitnerBox)
      : boxedCards.slice(0, 8);

    if (!visibleCards.length) {
      elements.flashcardHistory.append(
        emptyState(
          selectedLeitnerBox
            ? `جعبه ${formatNumber(selectedLeitnerBox)} خالی است.`
            : "هنوز ایراد یادگیری برای این موضوع ثبت نشده است."
        )
      );
      return;
    }

    visibleCards.forEach((card) => {
      const row = document.createElement("div");
      row.className = "mini-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = card.front;
      const detail = document.createElement("small");
      detail.textContent = `پاسخ: ${card.back} | جعبه ${formatNumber(card.state.box)} | ${formatDate(card.state.lastAt)}`;
      copy.append(title, detail);
      const action = makeActionButton("تمرین", "secondary-action flashcard-review-action", () => {
        selectedLeitnerBox = card.state.box;
        setActiveFlashcard(card, topicId);
        renderFlashcards();
      });
      row.append(copy, action);
      elements.flashcardHistory.append(row);
    });
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
    if (cloudMode) {
      void saveCloudLeagueResult(result);
    }
    persistActiveUser();
  }

  function getLeagueStandings() {
    if (supabaseClient) return cloudLeagueStandings;

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

  async function saveCloudLeagueResult(result) {
    if (!supabaseClient || !activeUser) return;
    const { data, error } = await supabaseClient
      .from("league_results")
      .insert({
        user_id: activeUser.id,
        topic_id: result.topicId,
        topic_label: result.topicLabel,
        raw_score: result.rawScore,
        score_per_question: result.scorePerQuestion,
        time_remaining_total: result.timeRemainingTotal,
        time_bonus: result.timeBonus,
        league_rating: result.leagueRating,
        answered: result.answered,
        correct: result.correct,
        wrong: result.wrong,
        percent: result.percent,
        duration_seconds: result.durationSeconds,
      })
      .select("id, created_at")
      .single();

    if (!error && data) {
      result.id = data.id;
      result.endedAt = data.created_at;
      await refreshCloudLeagueStandings();
      renderLeague();
    }
  }

  async function loadCloudUserLeagueResults(userId) {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from("league_results")
      .select("id, topic_id, topic_label, raw_score, score_per_question, time_remaining_total, time_bonus, league_rating, answered, correct, wrong, percent, duration_seconds, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (error || !Array.isArray(data)) return [];
    return data.map(mapCloudLeagueResult);
  }

  async function refreshCloudLeagueStandings() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient
      .from("league_results")
      .select("id, user_id, topic_id, topic_label, raw_score, score_per_question, time_remaining_total, time_bonus, league_rating, answered, correct, wrong, percent, duration_seconds, created_at")
      .order("league_rating", { ascending: false })
      .order("score_per_question", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(300);

    if (error || !Array.isArray(data)) {
      cloudLeagueStandings = [];
      return;
    }

    const userIds = [...new Set(data.map((row) => row.user_id).filter(Boolean))];
    const profileMap = new Map();
    if (userIds.length) {
      const { data: profiles } = await supabaseClient
        .from("profiles")
        .select("user_id, username")
        .in("user_id", userIds);
      (profiles || []).forEach((profile) => profileMap.set(profile.user_id, profile.username));
    }

    const bestByUser = new Map();
    data.forEach((row) => {
      const result = mapCloudLeagueResult(row);
      result.username = profileMap.get(row.user_id) || "کاربر";
      const previous = bestByUser.get(row.user_id);
      if (!previous || compareLeagueResults(result, previous) < 0) {
        bestByUser.set(row.user_id, result);
      }
    });
    cloudLeagueStandings = [...bestByUser.values()].sort(compareLeagueResults);
  }

  function mapCloudLeagueResult(row) {
    return {
      id: row.id,
      userId: row.user_id,
      topicId: row.topic_id,
      topicLabel: row.topic_label,
      rawScore: Number(row.raw_score || 0),
      scorePerQuestion: Number(row.score_per_question || 0),
      timeRemainingTotal: Number(row.time_remaining_total || 0),
      timeBonus: Number(row.time_bonus || 0),
      leagueRating: Number(row.league_rating || 0),
      answered: Number(row.answered || 0),
      correct: Number(row.correct || 0),
      wrong: Number(row.wrong || 0),
      percent: Number(row.percent || 0),
      durationSeconds: Number(row.duration_seconds || 0),
      endedAt: row.created_at,
    };
  }

  function compareLeagueResults(a, b) {
    if ((b.leagueRating || 0) !== (a.leagueRating || 0)) return (b.leagueRating || 0) - (a.leagueRating || 0);
    if ((b.scorePerQuestion || 0) !== (a.scorePerQuestion || 0)) return (b.scorePerQuestion || 0) - (a.scorePerQuestion || 0);
    return String(b.endedAt || "").localeCompare(String(a.endedAt || ""));
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
    if (elements.dashboardUser) elements.dashboardUser.textContent = label;
    if (elements.flashcardUser) elements.flashcardUser.textContent = label;
  }

  function clearAuthForms() {
    elements.loginEmails.forEach((input) => {
      input.value = "";
    });
    elements.loginPasswords.forEach((input) => {
      input.value = "";
    });
    elements.signupUsernames.forEach((input) => {
      input.value = "";
    });
    elements.signupEmails.forEach((input) => {
      input.value = "";
    });
    elements.signupPasswords.forEach((input) => {
      input.value = "";
    });
  }

  function setAuthStatus(message, variant) {
    elements.authStatusMessages.forEach((status) => {
      status.textContent = message;
      status.className = variant ? `auth-status ${variant}` : "auth-status";
    });
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
      flashcards: store.flashcards,
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

  function getFlashcardTopic(topicId = selectedFlashcardTopicId) {
    const safeTopicId = FLASHCARD_TOPIC_IDS.includes(topicId) ? topicId : "brandGeneric";
    return TOPICS[safeTopicId];
  }

  function getTopicStore(topicId = selectedTopicId) {
    const safeTopicId = getTopic(topicId).id;
    if (!store.topics[safeTopicId]) store.topics[safeTopicId] = makeEmptyTopicStore();
    return store.topics[safeTopicId];
  }

  function getFlashcardTopicStore(topicId = selectedFlashcardTopicId) {
    const safeTopicId = getFlashcardTopic(topicId).id;
    if (!store.flashcards) store.flashcards = makeEmptyFlashcardStore();
    if (!store.flashcards.topics || typeof store.flashcards.topics !== "object") {
      store.flashcards = normalizeFlashcardStore(store.flashcards);
    }
    if (!store.flashcards.topics[safeTopicId]) {
      store.flashcards.topics[safeTopicId] = makeEmptyFlashcardTopicStore();
    }
    return store.flashcards.topics[safeTopicId];
  }

  function getFlashcardCardState(topicId, drugId, key = makeFlashcardKey(topicId, drugId)) {
    const saved = getFlashcardTopicStore(topicId).cards[key];
    const inBox = Boolean(saved);
    return {
      key,
      topicId,
      drugId,
      inBox,
      box: inBox ? clamp(Number(saved?.box || 1), 1, LEITNER_BOX_COUNT) : 0,
      dueAt: saved?.dueAt || "",
      reviewed: Number(saved?.reviewed || 0),
      correct: Number(saved?.correct || 0),
      wrong: Number(saved?.wrong || 0),
      lastGrade: saved?.lastGrade || "",
      lastAt: saved?.lastAt || "",
    };
  }

  function makeFlashcardKey(topicId, drugId) {
    return `${topicId}:${drugId}`;
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

  function normalizeEmail(value) {
    return String(value || "").trim().toLocaleLowerCase();
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
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
