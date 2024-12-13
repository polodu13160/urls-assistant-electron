const {
  app,
  BrowserWindow,
  Menu,
  session,
  dialog,
  clipboard,
} = require("electron");
const prompt = require("electron-prompt");
const fs = require("fs");
const path = require("path");

let win;
let userSettings;

const isMac = process.platform === "darwin";

const defaultSettings = {
  assistant: "ChatGPT",
};

// Chemin vers le fichier settings.json dans le répertoire de données utilisateur
const userDataPath = app.getPath("userData");
const settingsPath = path.join(userDataPath, "settings.json");
const configPath = path.join(userDataPath, "config.json");
const sessionFile = path.join(userDataPath, "sessions.json");

// Charger les paramètres au démarrage de l'application
let settings;
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
} else {
  // Si le fichier n'existe pas, initialiser avec des valeurs par défaut
  settings = { availableFavurls: [] };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
let availableFavurls = settings.availableFavurls || [];

// Fonction pour sauvegarder les paramètres
function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function changeAssistant(label, url, save = false, killCookies = true) {
  // kill cookies on favurl change to prevent cookie errors:
  if (killCookies)
    win.webContents.session.clearStorageData({ storages: ["cookies"] });
  win.loadURL(url);
  if (save) {
    let currentSettings = Object.assign(
      {},
      userSettings || loadUserPreferences()
    ); // mock
    const mutateConfig = Object.assign(currentSettings, { assistant: label }); // mutate
    userSettings = mutateConfig; // assign
    fs.writeFileSync(configPath, JSON.stringify(userSettings), "utf-8"); // save
  }
}

function loadUserPreferences() {
  if (fs.existsSync(configPath)) {
    const configFile = fs.readFileSync(configPath, "utf-8");
    userSettings = JSON.parse(configFile);
    return userSettings;
  } else {
    // create config file if it does not exist
    fs.writeFileSync(configPath, JSON.stringify(defaultSettings)); // create settings
    return loadUserPreferences();
  }
}

function fetchThemes() {
  const cssFiles = fs
    .readdirSync(userDataPath)
    .filter((file) => path.extname(file) === ".css")
    .map((label) => label);
  return cssFiles || ["default.css"];
}

function getSessions() {
  if (fs.existsSync(sessionFile)) {
    const sessions = JSON.parse(fs.readFileSync(sessionFile));
    return sessions || {};
  } else {
    fs.writeFileSync(sessionFile, "{}", "utf-8");
    return getSessions();
  }
}

function getSessionsNames() {
  return Object.keys(getSessions() || {}) || [];
}

function removeSession(name, session) {
  const mutableSession = getSessions() || {};
  if (mutableSession[name]) {
    delete mutableSession[name];
    fs.writeFileSync(sessionFile, JSON.stringify(mutableSession));
    setTimeout(() => win.reload(), 1000);
  }
}

function storeSession(name, session) {
  if (Object.keys(session).length) {
    const mutableSession = getSessions() || {};
    session.cookies.get({}).then((cookies) => {
      mutableSession[name] = { cookies };
      fs.writeFileSync(sessionFile, JSON.stringify(mutableSession));
    });
  }
}

function loadSession(name, session) {
  const existingSessions = getSessions();
  const cookies = existingSessions[name]?.cookies || [];
  if (fs.existsSync(sessionFile)) {
    session.clearStorageData();
    cookies.forEach((cookie) => {
      const url = `https://${cookie.domain.replace(/^\./, "")}`;
      if (cookie.name.startsWith("__Secure-")) cookie.secure = true; // flag safe
      if (cookie.name.startsWith("__Host-")) {
        cookie.secure = true; // flag safe
        cookie.path = "/"; // set root path
        delete cookie.domain; // delete, refer to url
        delete cookie.sameSite; // allow cookies from third auth
      }
      session.cookies
        .set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate,
        })
        .then(() => {
          // console.log(`${url} cookie ${cookie.name} restored`);
        })
        .catch((error) => {
          console.error("Error while opening cookie :", error);
        });
    });
    win.reload();
  }
}

function generateMenu() {
  const sessionMenuTemplate = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "quit" }, // Cmd + Q pour quitter
            ],
          },
        ]
      : []),
    // Edition Menu
    ...(isMac
      ? [
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
        ]
      : []),
    {
      label: "Change Platform",
      submenu: availableFavurls
        .filter(({ available }) => available)
        .map(({ label, url }) => ({
          label,
          type: "checkbox",
          checked:
            (userSettings.assistant || defaultSettings.assistant) === label,
          click() {
            changeAssistant(label, url, true);
          },
        })),
    },
    {
      label: "Sessions",
      submenu: [
        ...getSessionsNames().map((name) => ({
          label: name,
          click() {
            loadSession(name, session.defaultSession);
          },
        })),
        {
          type: "separator",
        },
        {
          label: "Save Current Session",
          click: async () => {
            const ask = () => {
              prompt({
                title: "Saving Current Session",
                label: "Please chose a name:",
                inputAttrs: {
                  type: "text",
                },
                type: "input",
              })
                .then((text) => {
                  if (text === "") ask();
                  else if (text !== null) {
                    storeSession(text, session.defaultSession);
                    setTimeout(() => loadSession(text, session.defaultSession));
                  }
                })
                .catch(console.error);
            };
            ask();
          },
        },
        {
          label: "Delete A Session",
          click: async () => {
            const sessionNames = getSessionsNames();
            const ask = () => {
              prompt({
                title: "Delete A Session",
                label: "Choose a session to remove:",
                type: "select",
                selectOptions: sessionNames.reduce((options, name) => {
                  options[name] = name;
                  return options;
                }, {}),
              })
                .then((text) => {
                  if (text === "") ask();
                  else if (text !== null) {
                    const response = dialog.showMessageBoxSync({
                      type: "question",
                      buttons: ["Cancel", "Delete"],
                      defaultId: 0,
                      title: "Confirm Deletion",
                      message: `Are you sure you want to delete ${text}?`,
                    });
                    if (response === 1) {
                      removeSession(text, session.defaultSession);
                      // Refresh the session list
                      generateMenu();
                    }
                  }
                })
                .catch(console.error);
            };
            ask();
          },
        },
      ],
    },
    {
      label: "Settings",
      submenu: [
        {
          label: "Available URL",
          submenu: availableFavurls.map(({ label, id, available }) => ({
            label,
            type: "checkbox",
            checked: available === true,
            click() {
              toggleAvailableFavurl(id);
            },
          })),
        },
        {
          type: "separator",
        },
        {
          label: "Nouveau lien",
          click: addNewFavurlPrompt(),
        },
        {
          label: "Deleted URL",
          submenu: availableFavurls.map(({ label, id, available }) => ({
            label,
            type: "checkbox",
            click() {
              deleteAvailableFavurl(id);
            },
          })),
        },
      ],
    },
    {
      label: "Actions",
      submenu: [
        {
          label: "Copier l'URL",
          click: () => {
            const currentURL = win.webContents.getURL();
            clipboard.writeText(currentURL);
            dialog.showMessageBox({
              type: "info",
              message: "URL copiée dans le presse-papiers",
              buttons: ["OK"],
            });
          },
        },
        {
          label: "Accéder à une URL",
          click: async () => {
            const url = await prompt({
              title: "Accéder à une URL",
              label: "Entrez l'URL:",
              inputAttrs: {
                type: "text",
              },
              type: "input",
            });

            if (url !== null && url.trim() !== "") {
              win.loadURL(url);
            }
          },
        },
        {
          label: "Rafraîchir",
          click: () => {
            win.reload();
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(sessionMenuTemplate);
  Menu.setApplicationMenu(menu);
}

function deleteAvailableFavurl(id) {
  const favurlIndex = availableFavurls.findIndex((favurl) => favurl.id === id);
  if (favurlIndex !== -1) {
    const favurlToDelete = availableFavurls[favurlIndex];
    const response = dialog.showMessageBoxSync({
      type: "question",
      buttons: ["Cancel", "Delete"],
      defaultId: 0,
      title: "Confirm Deletion",
      message: `Are you sure you want to delete ${favurlToDelete.label}?`,
    });
    if (response === 1) {
      // 'Delete' button is clicked
      availableFavurls.splice(favurlIndex, 1);
      saveSettings();
      generateMenu();
    }
  }
}

function toggleAvailableFavurl(id) {
  const favurlIndex = availableFavurls.findIndex((favurl) => favurl.id === id);
  if (favurlIndex !== -1) {
    availableFavurls[favurlIndex].available =
      !availableFavurls[favurlIndex].available;
    saveSettings();
    generateMenu();
  }
}

function addNewFavurlPrompt() {
  return async () => {
    const favurlName = await prompt({
      title: "Nouveau lien",
      label: "Please enter the Platform's name",
      inputAttrs: {
        type: "text",
      },
      type: "input",
    });

    if (favurlName === null || favurlName.trim() === "") return;

    const favurlUrl = await prompt({
      title: "Nouveau lien",
      label: "Please enter the URL",
      inputAttrs: {
        type: "text",
      },
      type: "input",
    });

    // Should also test if it is a valid link
    if (favurlUrl === null || favurlUrl.trim() === "") return; // User cancelled the prompt

    // Find the max id of availableFavurls to set the new favurl's id
    const nextId =
      availableFavurls.reduce(
        (maxId, favurl) => (favurl.id > maxId ? favurl.id : maxId),
        0
      ) + 1;

    availableFavurls.push({
      label: favurlName,
      url: favurlUrl,
      available: true,
      id: nextId,
    });

    // Save the updated availableFavurls to settings.json
    settings.availableFavurls = availableFavurls;
    saveSettings();

    //Optionally, refresh the menu to include the new favurl
    generateMenu();
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: false,
    frame: true,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      webviewTag: true,
      session: session.defaultSession,
    },
  });

  win.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

  loadUserPreferences();
  generateMenu();
  const isValidLabel = (label) =>
    availableFavurls.find((favurl) => favurl.label === label);
  const label = isValidLabel(userSettings.assistant)
    ? userSettings.assistant
    : defaultSettings.assistant;
  const favurl = availableFavurls.find((favurl) => favurl.label === label);
  const url = favurl ? favurl.url : "https://www.google.com"; // Utilisez une URL par défaut si l'élément n'existe pas
  changeAssistant(label, url, false, false);

  win.webContents.on("did-finish-load", (e) => {
    generateMenu();
  });

  win.on("closed", () => {
    win = null;
  });
}

app.commandLine.appendSwitch("disable-software-rasterizer");

app
  .whenReady()
  .then(createWindow)
  .catch((error) => {
    console.error("Failed to create window:", error);
  });

app.on("activate", () => {
  if (win === null)
    createWindow().catch((error) => {
      console.error("Failed to activate window:", error);
    });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
