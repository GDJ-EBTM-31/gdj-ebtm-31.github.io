/*
 * GDJ — l'application du groupe de jeunes de l'Église Baptiste Toulouse Métropole.
 *
 * Un accueil qui dit tout en un coup d'œil : ce qu'il y a à la une, la prochaine rencontre,
 * les sujets à préparer, les lectures et défis en cours, l'agenda. On entre dans un sujet
 * — ses questions, ses versets, ses réflexions, son partage — ou dans un défi, on coche, on
 * revient.
 *
 * Tout ce qui est écrit ou coché reste dans le navigateur de la personne (localStorage).
 * Rien n'est envoyé nulle part : les seuls départs possibles sont un partage ou une
 * sauvegarde que la personne déclenche elle-même, vers le destinataire qu'elle choisit.
 *
 * Le code ne contient aucun texte destiné à être lu : tout vient de contenu/interface.json
 * et des fichiers de contenu.
 */

(() => {
  "use strict";

  const PREFIXE = "gdj:";
  const principal = document.getElementById("principal");

  // Ce que l'application charge au démarrage. Sujets et défis sont chargés à la demande.
  let ui = null; // contenu/interface.json : tous les textes de l'interface
  let index = null; // contenu/index.json : la liste des sujets et des défis
  let infos = null; // contenu/infos.json : à la une, annonces, raccourcis
  let agenda = null; // contenu/agenda.json
  let pratique = null; // contenu/pratique.json
  const fichiers = new Map(); // chemin → contenu déjà chargé

  // ---------------------------------------------------------------------------
  // Petits outils
  // ---------------------------------------------------------------------------

  function echapper(texte) {
    return String(texte).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Modèle de chaîne sans échappement : le contenu inséré est déjà passé par echapper()
  // là où il vient de l'extérieur. Sert seulement à garder les gabarits lisibles.
  function html(morceaux, ...valeurs) {
    return morceaux.reduce((sortie, morceau, i) => sortie + morceau + (valeurs[i] ?? ""), "");
  }

  function remplir(modele, valeurs) {
    return String(modele).replace(/\{(\w+)\}/g, (_, cle) => (valeurs[cle] ?? ""));
  }

  // Le stockage peut être refusé (navigation privée, réglages stricts) : l'application
  // continue de fonctionner, sans mémoire, plutôt que de s'arrêter.
  function lire(cle) {
    try {
      return localStorage.getItem(PREFIXE + cle);
    } catch {
      return null;
    }
  }

  function ecrire(cle, valeur) {
    try {
      localStorage.setItem(PREFIXE + cle, valeur);
      return true;
    } catch {
      return false;
    }
  }

  function effacer(cle) {
    try {
      localStorage.removeItem(PREFIXE + cle);
    } catch {
      /* rien à effacer si rien n'a pu être écrit */
    }
  }

  // Toutes les clés de l'application, sans le préfixe.
  function clesEnregistrees() {
    const cles = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const cle = localStorage.key(i);
        if (cle && cle.startsWith(PREFIXE)) cles.push(cle.slice(PREFIXE.length));
      }
    } catch {
      /* stockage inaccessible : rien d'enregistré */
    }
    return cles;
  }

  // L'état d'un défi tient dans une seule clé : les étapes cochées et les lignes écrites.
  // Une clé par défi, et non par étape, pour que l'accueil compte l'avancement de chacun sans
  // charger son fichier.
  function lireDefi(id) {
    try {
      const brut = lire("defi:" + id);
      const etat = brut ? JSON.parse(brut) : {};
      return { faites: etat.faites || {}, notes: etat.notes || {} };
    } catch {
      return { faites: {}, notes: {} };
    }
  }

  function ecrireDefi(id, etat) {
    return ecrire("defi:" + id, JSON.stringify(etat));
  }

  function compterFaites(id) {
    return Object.keys(lireDefi(id).faites).length;
  }

  function sujetArchive(id) {
    return Boolean(lire("archive:sujet:" + id));
  }

  // On compte les ouvertures de l'application installée : la carte de bienvenue s'appuie
  // dessus, et disparaît d'elle-même à la quatrième, même sans avoir été fermée.
  function compterOuverture() {
    const n = parseInt(lire("ouvertures") || "0", 10) + 1;
    ecrire("ouvertures", String(n));
    return n;
  }

  function bienvenueAMontrer() {
    if (lire("bienvenue-vue")) return false;
    return parseInt(lire("ouvertures") || "0", 10) <= 3;
  }

  // Le rappel de sauvegarde. Sans serveur, un téléphone perdu emporte tout : une carte le
  // rappelle sur l'accueil quand le jeune a quelque chose à perdre et n'a rien sauvegardé
  // depuis un mois. « Plus tard » la fait revenir une semaine après ; le réglage « Jamais »
  // l'éteint. Demandé par Sébastien le 11 septembre 2026.
  const RAPPEL_JOURS = 30;
  const RAPPEL_REPORT_JOURS = 7;

  // Ce qui mérite d'être sauvegardé : une réponse écrite, une étape cochée, une ligne écrite.
  function aDesReponses() {
    return clesEnregistrees().some((cle) => {
      if (cle.startsWith("sujet:")) return Boolean((lire(cle) || "").trim());
      if (cle.startsWith("defi:")) {
        const etat = lireDefi(cle.slice("defi:".length));
        return Object.keys(etat.faites).length > 0 || Object.keys(etat.notes).length > 0;
      }
      return false;
    });
  }

  function rappelSauvegardeAMontrer() {
    if (lire("rappel-sauvegarde") === "jamais" || !aDesReponses()) return false;
    const aujourdhui = aujourdhuiISO();
    const reporte = lire("rappel-reporte");
    if (reporte && reporte > aujourdhui) return false;
    const derniere = lire("sauvegarde-date");
    const depuis = derniere ? jourISO(new Date(derniere)) : lire("rappel-depuis");
    if (!depuis) {
      // Premières réponses sans aucune sauvegarde : le mois commence aujourd'hui.
      ecrire("rappel-depuis", aujourdhui);
      return false;
    }
    return -joursAvant(depuis) >= RAPPEL_JOURS;
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------
  //
  // L'agenda écrit ses dates en AAAA-MM-JJ. On les lit comme des dates locales, jamais en
  // UTC : une rencontre du samedi ne doit pas s'afficher vendredi soir.

  function dateLocale(iso) {
    const [annee, mois, jour] = iso.split("-").map(Number);
    return new Date(annee, mois - 1, jour);
  }

  function jourISO(d) {
    const deux = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
  }

  function aujourdhuiISO() {
    return jourISO(new Date());
  }

  function demainISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return jourISO(d);
  }

  function majuscule(texte) {
    return texte.charAt(0).toUpperCase() + texte.slice(1);
  }

  function formaterDate(iso) {
    if (iso === aujourdhuiISO()) return ui.agenda.aujourdhui;
    if (iso === demainISO()) return ui.agenda.demain;
    const texte = dateLocale(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    // « dimanche 1 novembre » se dit « 1er novembre » ; le navigateur ne le sait pas.
    return majuscule(texte.replace(/(^|\s)1(\s)/, "$11er$2"));
  }

  // Des espaces insécables : « 21 h 30 » ne se coupe pas en fin de ligne.
  function formaterHeure(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":");
    return m && m !== "00" ? `${Number(h)}\u00a0h\u00a0${m}` : `${Number(h)}\u00a0h`;
  }

  function formaterHoraire(evenement) {
    if (!evenement.heure) return "";
    if (evenement.fin) return remplir(ui.agenda.de, { debut: formaterHeure(evenement.heure), fin: formaterHeure(evenement.fin) });
    return remplir(ui.agenda.a, { heure: formaterHeure(evenement.heure) });
  }

  function formaterDateHeure(date) {
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + " à " + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  // Le nombre de jours d'ici une date, en jours pleins : « Dans 3 jours ».
  function joursAvant(iso) {
    const cible = dateLocale(iso);
    const maintenant = dateLocale(aujourdhuiISO());
    return Math.round((cible - maintenant) / 86400000);
  }

  // Ce qu'on met en avant sous la date de la prochaine rencontre : rien pour aujourd'hui et demain (la date le dit
  // déjà), « Dans n jours » jusqu'à un mois, rien au-delà.
  function delaiAvant(iso) {
    const jours = joursAvant(iso);
    if (jours < 2 || jours > 31) return "";
    return remplir(ui.agenda.dansJours, { n: jours });
  }

  function evenementsAVenir() {
    const aujourdhui = aujourdhuiISO();
    return (agenda.evenements || []).filter((e) => e.date >= aujourdhui).sort((a, b) => (a.date + (a.heure || "")).localeCompare(b.date + (b.heure || "")));
  }

  function evenementsPasses() {
    const aujourdhui = aujourdhuiISO();
    return (agenda.evenements || []).filter((e) => e.date < aujourdhui).sort((a, b) => (b.date + (b.heure || "")).localeCompare(a.date + (a.heure || "")));
  }

  // ---------------------------------------------------------------------------
  // Taille du texte
  // ---------------------------------------------------------------------------
  //
  // Le cran de départ est « Normal », c'est-à-dire la taille que la personne a déjà choisie
  // dans les réglages de son téléphone. Les crans suivants l'agrandissent ; aucun ne la
  // réduit, ce serait lui reprendre son propre réglage sans qu'elle comprenne pourquoi.

  const TAILLES = [
    { nom: "Normal", valeur: "1" },
    { nom: "Grand", valeur: "1.15" },
    { nom: "Très grand", valeur: "1.3" },
  ];

  function appliquerTaille(valeur) {
    document.documentElement.style.setProperty("--echelle", valeur);
  }

  appliquerTaille(lire("taille") || "1");

  // ---------------------------------------------------------------------------
  // Installation sur l'écran d'accueil
  // ---------------------------------------------------------------------------
  //
  // Ce n'est pas du confort. L'application se remplit sur toute l'année. Or Safari efface
  // les données d'un site resté sept jours sans visite ; une application ajoutée à l'écran
  // d'accueil y échappe. Sans installation, ce qui est écrit peut disparaître.

  // L'icône « Partager » d'iOS : un carré ouvert vers le haut, traversé par une flèche.
  const PARTAGE_IOS = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M12 3.5 L12 15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" /><path d="M8 7 L12 3.2 L16 7" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path
      d="M7.5 10.5 L5.5 10.5 L5.5 20.5 L18.5 20.5 L18.5 10.5 L16.5 10.5" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

  let installationDifferee = null;

  // Deux signes, et il en suffit d'un. Le mode « standalone » est le signe normal, mais tous
  // les navigateurs ne le rapportent pas de façon fiable ; le manifeste ouvre donc
  // l'application sur « ?app », marqueur que seule elle porte. Sans l'un ou l'autre, on est
  // dans un navigateur ordinaire, et il n'y a rien d'autre à montrer que l'installation.
  function dejaInstallee() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      new URLSearchParams(location.search).has("app")
    );
  }

  function surIPhone() {
    const ua = navigator.userAgent;
    // iPadOS se présente comme un Mac : on le reconnaît à son écran tactile.
    return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  // Un téléphone, ou une tablette : iPhone, iPad, Android. Tout le reste est un ordinateur,
  // qui n'installe pas l'application et renvoie vers le téléphone.
  function surTelephone() {
    const ua = navigator.userAgent;
    return /iPhone|iPod|iPad|Android/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  // Chrome et Edge annoncent leur capacité à installer par « beforeinstallprompt ». Firefox
  // Android ne le fait pas : on lui laisse un instant, puis on se rabat sur une explication.
  let apiInstallationAttendue = true;
  setTimeout(() => {
    apiInstallationAttendue = false;
    // Seul l'écran d'installation dépend de cette attente : dans l'application installée, on
    // ne réaffiche rien — quelqu'un peut déjà être en train d'écrire.
    if (!installationDifferee && !dejaInstallee()) afficher();
  }, 1500);

  window.addEventListener("beforeinstallprompt", (evenement) => {
    evenement.preventDefault(); // on choisit le moment plutôt que de le laisser au navigateur
    installationDifferee = evenement;
    afficher();
  });

  // L'installation vient d'aboutir : le navigateur qui reste ouvert derrière n'a plus rien
  // à montrer, l'application prend le relais depuis l'écran d'accueil.
  window.addEventListener("appinstalled", () => {
    installationDifferee = null;
  });

  function etapesInstallation() {
    // Dans la fenêtre interne d'une application, aucune installation n'est possible : la
    // seule étape utile est d'en sortir. C'est le cas le plus probable ici, le lien
    // circulant dans un groupe.
    if (dansNavigateurIntegre()) {
      return html`<ol class="invite__etapes">
          <li>Touche <strong>•••</strong> ou <strong>⋮</strong> en haut de l’écran.</li>
          <li>Touche « Ouvrir dans le navigateur » ou « Ouvrir dans Safari ».</li>
          <li>Reprends alors cette page depuis le début.</li>
        </ol>`;
    }
    if (installationDifferee) {
      return html`<button type="button" class="bouton-principal" data-invite="installer">Installer</button>`;
    }
    if (surIPhone()) {
      return html`<ol class="invite__etapes">
        <li>
          Touche <span class="invite__icone">${PARTAGE_IOS}</span> en bas de l’écran. Si tu ne la vois
          pas, touche <strong>•••</strong> puis « Partager ».
        </li>
        <li>Fais défiler — ou touche « En voir plus » — jusqu’à « Sur l’écran d’accueil ».</li>
        <li>Touche « Ajouter ».</li>
      </ol>`;
    }
    return html`<ol class="invite__etapes">
      <li>Ouvre le menu de ton navigateur.</li>
      <li>Touche « Installer » ou « Ajouter à l’écran d’accueil ».</li>
    </ol>`;
  }

  // Toujours affiché, sous les instructions. Notre détection ne peut pas reconnaître toutes
  // les fenêtres internes d'application — celle de WhatsApp sur Android, notamment, se
  // présente parfois comme un navigateur ordinaire. Ce bloc laisse une sortie dans tous les
  // cas, sans rien avoir à détecter.
  function blocSecours() {
    const s = ui.installation.secours;
    return html`
      <details class="secours">
        <summary class="secours__titre">${echapper(s.titre)}</summary>
        <div class="secours__contenu">
          <p class="secours__texte">${echapper(s.texte)}</p>
          <p class="secours__lien" id="lien-installation">${echapper(location.origin + location.pathname)}</p>
          <button type="button" class="bouton-secondaire" id="copier-lien">${echapper(s.bouton)}</button>
          <p class="confirmation" id="confirmation-lien" role="status"></p>
        </div>
      </details>
    `;
  }

  function ecranInstallation() {
    const e = ui.installation;
    const consigne = dansNavigateurIntegre() ? e.consigneNavigateurIntegre : e.consigne;
    return html`
      <section class="orientation">
        <div class="carte-installation">
          <img
            class="carte-installation__icone"
            src="icones/icone-192.png"
            alt="Icône de l’application, telle qu’elle apparaîtra sur ton écran d’accueil"
            width="192"
            height="192"
          />
          <h1 class="carte-installation__soustitre">${echapper(e.sousTitre)}</h1>
          <p class="carte-installation__texte">${echapper(e.presentation)}</p>
          <div class="carte-installation__action">
            <p class="orientation__consigne">${echapper(consigne)}</p>
            ${etapesInstallation()}
          </div>
        </div>
        ${blocSecours()}
      </section>
    `;
  }

  // Sur un ordinateur, pas d'installation : un seul écran, qui renvoie vers le téléphone avec
  // le QR code à scanner et le lien. Ni bouton « Installer », ni sortie. Décidé par Sébastien
  // le 11 septembre 2026 : « uniquement une installation sur téléphone » — la fiche Varak,
  // elle, traitait l'ordinateur comme les autres.
  function ecranOrdinateur() {
    const e = ui.installation;
    const o = ui.ordinateur;
    const adresse = location.origin + location.pathname;
    return html`
      <section class="orientation">
        <div class="carte-installation">
          <img class="carte-installation__icone" src="icones/icone-192.png" alt="" width="192" height="192" />
          <h1 class="carte-installation__soustitre">${echapper(e.sousTitre)}</h1>
          <p class="carte-installation__texte">${echapper(o.texte)}</p>
          <img class="qr__image" src="qr-gdj.png" alt="${echapper(remplir(o.qrAlt, { adresse }))}" width="320" height="320" />
          <p class="carte-installation__texte">${echapper(o.lien)}</p>
          <p class="qr__adresse">${echapper(adresse)}</p>
        </div>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Navigateur intégré à une application
  // ---------------------------------------------------------------------------
  //
  // Un lien ouvert depuis WhatsApp ou Instagram s'affiche souvent dans un navigateur interne
  // à ces applications, qui a son propre stockage. Ce qui est écrit là est introuvable quand
  // on rouvre l'application depuis Safari ou Chrome, et disparaît parfois tout seul.

  function dansNavigateurIntegre() {
    const ua = navigator.userAgent;
    // Signatures explicites, tous systèmes confondus.
    if (/FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|Twitter/i.test(ua)) return true;
    // Android : une vue web embarquée se signale par « wv ».
    if (/Android/.test(ua) && /;\s*wv\)/.test(ua)) return true;
    // iOS : tous les navigateurs passent par WebKit, mais seuls les vrais navigateurs
    // écrivent « Safari/ » ou se nomment (Chrome, Firefox, Edge). Une vue web embarquée n'a
    // ni l'un ni l'autre.
    if (/iPhone|iPod|iPad/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return true;
    return false;
  }

  // Navigation privée, stockage plein, réglages stricts : ce qui est tapé ne sera pas gardé.
  // Le dire tout de suite, plutôt que de laisser quelqu'un écrire dans le vide.
  function stockageIndisponible() {
    try {
      const essai = PREFIXE + "essai";
      localStorage.setItem(essai, "1");
      localStorage.removeItem(essai);
      return false;
    } catch {
      return true;
    }
  }

  function avertissementStockage() {
    if (!stockageIndisponible()) return "";
    return html`<section class="message message--erreur" role="alert">${echapper(ui.stockageBloque)}</section>`;
  }

  function bandeauNavigateur() {
    if (dejaInstallee() || !dansNavigateurIntegre()) return "";
    const n = ui.navigateurIntegre;
    return html`<section class="bandeau-navigateur">
      <p><strong>${echapper(n.titre)}</strong> ${echapper(n.texte)}</p>
    </section>`;
  }

  // ---------------------------------------------------------------------------
  // Icônes, dessinées à la main, sans dépendance
  // ---------------------------------------------------------------------------

  const CHEVRON_DROIT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
      focusable="false"><path d="M9 5 L16 12 L9 19" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
  const PARTAGE = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
      focusable="false"><path d="M12 3.5 L12 15" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" /><path d="M8 7 L12 3.2 L16 7" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path
      d="M7.5 10.5 L5.5 10.5 L5.5 20.5 L18.5 20.5 L18.5 10.5 L16.5 10.5" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
  const QR = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
      focusable="false"><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" fill="none"
      stroke="currentColor" stroke-width="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"
      fill="none" stroke="currentColor" stroke-width="2" /><rect x="3.5" y="13.5" width="7" height="7"
      rx="1.2" fill="none" stroke="currentColor" stroke-width="2" /><rect x="14" y="14" width="2.6"
      height="2.6" fill="currentColor" /><rect x="18" y="14" width="2.6" height="2.6" fill="currentColor" /><rect
      x="14" y="18" width="2.6" height="2.6" fill="currentColor" /><rect x="18" y="18" width="2.6"
      height="2.6" fill="currentColor" /></svg>`;
  const INFO = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
      focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor"
      stroke-width="2" /><path d="M12 11 L12 16.5" stroke="currentColor" stroke-width="2.2"
      stroke-linecap="round" /><circle cx="12" cy="7.8" r="1.2" fill="currentColor" /></svg>`;
  // Une Bible : un livre fermé, la croix sur la couverture.
  const BIBLE = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
      focusable="false"><rect x="4.5" y="3" width="15" height="18" rx="2" fill="none"
      stroke="currentColor" stroke-width="2" /><path d="M8 3 V21" stroke="currentColor"
      stroke-width="2" /><path d="M13.75 7.5 V15 M11 10.25 H16.5" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" /></svg>`;
  // Un sujet : une bulle de conversation.
  const BULLE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M4 6.5 A2.5 2.5 0 0 1 6.5 4 H17.5 A2.5 2.5 0 0 1 20 6.5 V14 A2.5 2.5 0 0 1 17.5 16.5 H10 L5.5 20 V16.5 H6.5 A2.5 2.5 0 0 1 4 14 Z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M8.5 9 H15.5 M8.5 12 H13"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>`;
  // Une lecture : un livre ouvert.
  const LIVRE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M12 6.5 C10 4.8 7 4.5 3.5 5 V18.5 C7 18 10 18.3 12 20 C14 18.3 17 18 20.5 18.5 V5 C17 4.5 14 4.8 12 6.5 Z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M12 6.5 V20"
      stroke="currentColor" stroke-width="2" /></svg>`;
  // Un défi : un drapeau planté.
  const DRAPEAU = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M6 21 V4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /><path
      d="M6 4.5 H17.5 L15 8.5 L17.5 12.5 H6" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linejoin="round" /></svg>`;
  // Une coche.
  const COCHE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
      focusable="false"><path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke="currentColor"
      stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
  // Un calendrier.
  const CALENDRIER = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none"
      stroke="currentColor" stroke-width="2" /><path d="M3.5 10 H20.5 M8 3 V7 M16 3 V7"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>`;
  // Un lien vers l'extérieur : une flèche qui sort d'un cadre.
  const EXTERIEUR = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
      focusable="false"><path d="M14 4.5 H19.5 V10" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" /><path d="M19.5 4.5 L11 13" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" /><path d="M10 6 H6.5 A2 2 0 0 0 4.5 8 V17.5 A2 2 0 0 0 6.5 19.5 H16 A2 2 0 0 0 18 17.5 V14"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>`;
  // Une boussole, pour la fiche Pratique.
  const BOUSSOLE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor"
      stroke-width="2" /><path d="M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z" fill="currentColor" /></svg>`;
  // L'engrenage des réglages.
  const ENGRENAGE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path fill="currentColor" fill-rule="evenodd"
      d="M9.26 1.76 L14.74 1.76 L14.12 4.08 L16.1 4.9 L17.3 2.82 L21.18 6.7 L19.1 7.9 L19.92 9.88 L22.24 9.26 L22.24 14.74 L19.92 14.12 L19.1 16.1 L21.18 17.3 L17.3 21.18 L16.1 19.1 L14.12 19.92 L14.74 22.24 L9.26 22.24 L9.88 19.92 L7.9 19.1 L6.7 21.18 L2.82 17.3 L4.9 16.1 L4.08 14.12 L1.76 14.74 L1.76 9.26 L4.08 9.88 L4.9 7.9 L2.82 6.7 L6.7 2.82 L7.9 4.9 L9.88 4.08 Z M8.5 12 A3.5 3.5 0 1 0 15.5 12 A3.5 3.5 0 1 0 8.5 12 Z" /></svg>`;
  // Le logo du groupe en petit, pour l'onglet Accueil : « GDJ » en blanc sur le dégradé de
  // l'icône. Demandé par Sébastien le 11 septembre 2026, à la place d'une maison. Il garde ses
  // couleurs sur tous les écrans ; la pastille et le libellé disent où l'on est.
  const LOGO_GDJ = `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"
      focusable="false"><defs><linearGradient id="degrade-onglet-gdj" x1="0" y1="0" x2="1" y2="1"><stop
      offset="0" stop-color="#982898" /><stop offset="1" stop-color="#d40775" /></linearGradient></defs><circle
      cx="14" cy="14" r="14" fill="url(#degrade-onglet-gdj)" /><text x="14" y="17.6" text-anchor="middle"
      font-size="10" font-weight="800" letter-spacing="0.2" fill="#ffffff">GDJ</text></svg>`;
  // Trois points dans un cercle : « plus ».
  const PLUS = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
      focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor"
      stroke-width="2" /><circle cx="7.5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12"
      r="1.4" fill="currentColor" /><circle cx="16.5" cy="12" r="1.4" fill="currentColor" /></svg>`;
  // Une sauvegarde : une flèche qui descend dans un bac.
  const SAUVEGARDE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M12 3.5 V14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /><path
      d="M8 10.5 L12 14.5 L16 10.5" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" /><path d="M4.5 15 V18.5 A2 2 0 0 0 6.5 20.5 H17.5 A2 2 0 0 0 19.5 18.5 V15"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>`;
  // Un lieu : une épingle.
  const LIEU = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
      focusable="false"><path d="M12 21 C12 21 5.5 14.5 5.5 10 A6.5 6.5 0 0 1 18.5 10 C18.5 14.5 12 21 12 21 Z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><circle cx="12" cy="10" r="2.2"
      fill="none" stroke="currentColor" stroke-width="2" /></svg>`;
  // Une horloge.
  const HORLOGE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
      focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor"
      stroke-width="2" /><path d="M12 7.5 V12 L15 14" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" /></svg>`;

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  //
  // Une adresse par écran, dans le « # ». Ce n'est pas une coquetterie : sur Android, le
  // bouton retour du téléphone suit cet historique, et ramène d'une question à son sujet,
  // puis du sujet à l'accueil.

  function routeCourante() {
    const parties = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const [tete, id, sous] = parties;
    if (tete === "sujet" && id) {
      if (!sous) return { ecran: "sujet", id };
      if (["a-propos", "versets", "notes", "partager"].includes(sous)) return { ecran: "sujet-" + sous, id };
      const numero = parseInt(sous.replace("q", ""), 10);
      if (numero >= 1) return { ecran: "question", id, index: numero - 1 };
      return { ecran: "sujet", id };
    }
    if (tete === "defi" && id) return { ecran: "defi", id };
    if (["sujets", "defis", "agenda", "plus", "pratique", "a-propos", "decouvrir", "sauvegarde", "reglages"].includes(tete)) return { ecran: tete };
    return { ecran: "accueil" };
  }

  function aller(destination) {
    const cible = "#/" + (destination || "");
    if (location.hash === cible) return afficher();
    location.hash = cible;
  }

  // Les transitions ne sont qu'un confort : là où le navigateur ne les connaît pas, ou là où
  // la personne a demandé moins d'animations, on change d'écran sans façon.
  function transition(changer) {
    const sobre = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || sobre) return changer();
    // Deux affichages qui se suivent de près : le second interrompt le premier, et le
    // navigateur le signale par une promesse rejetée. Le contenu, lui, est bien mis à jour ;
    // on ne laisse pas ce signal remonter en erreur.
    const t = document.startViewTransition(changer);
    for (const promesse of [t.ready, t.finished, t.updateCallbackDone]) promesse.catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Chargement du contenu
  // ---------------------------------------------------------------------------

  // « no-cache » : le navigateur redemande au serveur si le fichier a changé, au lieu de
  // resservir sa propre copie pendant des minutes. Hors connexion, c'est le service worker
  // qui répond avec la dernière version reçue.
  async function chargerJson(chemin) {
    const reponse = await fetch("contenu/" + chemin, { cache: "no-cache" });
    if (!reponse.ok) throw new Error(chemin);
    return reponse.json();
  }

  // Sujets et défis sont chargés la première fois qu'on les ouvre, puis gardés en mémoire.
  async function charger(chemin) {
    if (!fichiers.has(chemin)) fichiers.set(chemin, await chargerJson(chemin));
    return fichiers.get(chemin);
  }

  // Après le premier affichage, tout le contenu est demandé en arrière-plan : le service
  // worker le garde, et chaque sujet, chaque défi s'ouvre ensuite sans connexion.
  function precharger() {
    const tous = [...index.sujets, ...index.defis];
    tous.forEach((entree) => {
      charger(entree.fichier).catch(() => {
        /* hors connexion : on réessaiera à la prochaine ouverture */
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Morceaux d'écran réutilisés
  // ---------------------------------------------------------------------------

  function carte({ aller, classe = "", pastille, titre, sous = "", etiquette = "", glissable = null }) {
    const attributs = glissable
      ? html` class="glissable" data-sujet="${echapper(glissable.sujet)}" data-etiquette="${echapper(glissable.etiquette)}"`
      : "";
    return html`
      <li${attributs}>
        <button type="button" class="fiche ${classe}" data-aller="${echapper(aller)}">
          ${pastille}
          <span class="fiche__texte">
            <span class="fiche__titre">${echapper(titre)}</span>
            ${sous ? html`<span class="fiche__sous">${echapper(sous)}</span>` : ""}
          </span>
          ${etiquette ? html`<span class="etiquette etiquette--vive">${echapper(etiquette)}</span>` : ""}
          ${CHEVRON_DROIT}
        </button>
      </li>
    `;
  }

  // L'anneau d'avancement d'un défi : la part faite, en couleur, sur le tour complet.
  // Terminé, il se remplit et porte une coche.
  function anneau(faites, total) {
    const part = total ? Math.min(faites / total, 1) : 0;
    const tour = 2 * Math.PI * 15.5;
    const termine = total > 0 && faites >= total;
    return html`
      <span class="fiche__pastille fiche__pastille--anneau ${termine ? "fiche__pastille--termine" : ""}" aria-hidden="true">
        <svg class="anneau" viewBox="0 0 36 36" width="36" height="36">
          <circle class="anneau__fond" cx="18" cy="18" r="15.5" />
          ${part > 0 ? html`<circle class="anneau__part" cx="18" cy="18" r="15.5" stroke-dasharray="${(part * tour).toFixed(2)} ${tour.toFixed(2)}" />` : ""}
        </svg>
        ${termine ? html`<span class="anneau__coche">${COCHE}</span>` : ""}
      </span>
    `;
  }

  function pastille(icone, classe = "") {
    return html`<span class="fiche__pastille ${classe}">${icone}</span>`;
  }

  function badgeDate(iso) {
    const date = dateLocale(iso);
    const mois = date.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
    return html`<span class="date" aria-hidden="true">
      <span class="date__jour">${date.getDate()}</span>
      <span class="date__mois">${echapper(mois)}</span>
    </span>`;
  }

  function ligneEvenement(evenement, { detail = false, calendrier = false } = {}) {
    const horaire = formaterHoraire(evenement);
    return html`
      <li class="evenement">
        ${badgeDate(evenement.date)}
        <div class="evenement__texte">
          <p class="evenement__titre">${echapper(evenement.titre)}</p>
          <p class="evenement__quand">${echapper(formaterDate(evenement.date))}${horaire ? " · " + echapper(horaire) : ""}</p>
          ${evenement.lieu ? html`<p class="evenement__lieu">${LIEU} ${echapper(evenement.lieu)}</p>` : ""}
          ${detail && evenement.detail ? html`<p class="evenement__detail">${echapper(evenement.detail)}</p>` : ""}
          ${calendrier
            ? html`<a class="evenement__calendrier" href="agenda/${echapper(evenement.id)}.ics">${CALENDRIER} ${echapper(ui.agenda.ajouterCalendrier)}</a>`
            : ""}
        </div>
      </li>
    `;
  }

  // ---------------------------------------------------------------------------
  // L'accueil : tout en un coup d'œil
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // À la une : ce qu'on doit voir en un coup d'œil
  // ---------------------------------------------------------------------------
  //
  // Tout est posé, rien n'est caché : un défilement de cartes a été essayé puis retiré le
  // 11 septembre 2026, parce que ce qu'on fait glisser, on ne le voit pas. La carte en
  // couleur porte le mot des responsables — ou, aux premières ouvertures, l'explication de
  // l'application. Au-dessus, « Bonjour » et le prénom s'il est connu. Dessous, le rappel de
  // sauvegarde s'il y a lieu, la carte « À venir » où tiennent leurs annonces, et un nouveau
  // sujet s'il y en a un.

  function boutonUne(aller, libelle) {
    return html`<button type="button" class="une__action" data-aller="${echapper(aller)}">${echapper(libelle)} ${CHEVRON_DROIT}</button>`;
  }

  // La prochaine rencontre, en premier et en grand : c'est ce qu'on vient chercher le plus
  // souvent. Un toucher ouvre l'agenda.
  function blocRencontre() {
    const a = ui.accueil;
    const prochaine = evenementsAVenir()[0];
    if (!prochaine) return html`<p class="vide">${echapper(a.aucuneRencontre)}</p>`;
    const delai = delaiAvant(prochaine.date);
    return html`<button type="button" class="rencontre" data-aller="agenda">
      ${badgeDate(prochaine.date)}
      <span class="rencontre__texte">
        <span class="rencontre__etiquette">${echapper(a.prochaineRencontre)}</span>
        <span class="rencontre__titre">${echapper(prochaine.titre)}</span>
        <span class="rencontre__quand"><span>${echapper(formaterDate(prochaine.date))}${prochaine.heure ? " · " + echapper(formaterHeure(prochaine.heure)) : ""}</span>${delai ? html`<span class="rencontre__delai">${echapper(delai)}</span>` : ""}</span>
        ${prochaine.lieu ? html`<span class="rencontre__lieu">${echapper(prochaine.lieu)}</span>` : ""}
      </span>
      ${CHEVRON_DROIT}
    </button>`;
  }

  // Les raccourcis : ce qu'on vient chercher vite, écrit par les responsables dans
  // infos.json. Le feuillet de la cellule, par exemple.
  function blocRaccourcis() {
    const liste = infos.raccourcis || [];
    if (!liste.length) return "";
    const cartes = liste
      .map((r) => {
        if (r.url) return lienExterne(r);
        return carte({ aller: r.aller, classe: "fiche--raccourci", pastille: pastille(CHEVRON_DROIT), titre: r.titre, sous: r.description || "" });
      })
      .join("");
    return html`<h2 class="section-titre">${echapper(ui.accueil.raccourcis)}</h2><ul class="fiches">${cartes}</ul>`;
  }

  function blocALaUne() {
    const a = ui.accueil;
    if (bienvenueAMontrer()) {
      const b = ui.bienvenue;
      return html`
        <section class="une" aria-label="${echapper(b.etiquette)}">
          <p class="une__etiquette">${echapper(b.etiquette)}</p>
          <h1 class="une__titre">${echapper(b.titre)}</h1>
          <p class="une__texte">${echapper(b.texte)}</p>
          <ul class="une__liste">${(b.points || []).map((point) => html`<li>${echapper(point)}</li>`).join("")}</ul>
          <button type="button" class="une__action" data-bienvenue>${echapper(b.bouton)} ${COCHE}</button>
        </section>
      `;
    }
    const u = infos.aLaUne || {};
    if (!u.titre && !u.texte) return "";
    return html`
      <section class="une" aria-label="${echapper(a.aLaUne)}">
        <p class="une__etiquette">${echapper(a.aLaUne)}</p>
        ${u.titre ? html`<h1 class="une__titre">${echapper(u.titre)}</h1>` : ""}
        ${u.texte ? html`<p class="une__texte">${echapper(u.texte)}</p>` : ""}
      </section>
    `;
  }

  // « Bonjour Léa » en haut de l'accueil, quand le jeune a donné son prénom (dans les
  // réglages ou au moment de partager). « Bonsoir » à partir de 18 h. Sans prénom, rien.
  function blocBonjour() {
    const prenom = (lire("prenom") || "").trim();
    if (!prenom) return "";
    const modele = new Date().getHours() >= 18 ? ui.accueil.bonsoir : ui.accueil.bonjour;
    return html`<p class="bonjour">${echapper(remplir(modele, { prenom }))}</p>`;
  }

  function blocRappel() {
    if (!rappelSauvegardeAMontrer()) return "";
    const r = ui.rappel;
    const derniere = lire("sauvegarde-date");
    const quand = derniere
      ? remplir(r.depuis, { date: new Date(derniere).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }).replace(/^1 /, "1er ") })
      : r.jamais;
    return html`
      <section class="rappel" aria-labelledby="titre-rappel">
        ${pastille(SAUVEGARDE)}
        <div class="rappel__texte">
          <h2 class="rappel__titre" id="titre-rappel">${echapper(r.titre)}</h2>
          <p class="rappel__detail">${echapper(quand)} ${echapper(r.texte)}</p>
          <div class="rappel__actions">
            <button type="button" class="rappel__bouton rappel__bouton--principal" data-aller="sauvegarde">${echapper(r.sauvegarder)}</button>
            <button type="button" class="rappel__bouton" data-rappel-plus-tard>${echapper(r.plusTard)}</button>
          </div>
        </div>
      </section>
    `;
  }

  // « À venir » : les annonces des responsables en une seule carte, une ligne chacune — un
  // petit pavé de date, le titre, une précision. Tout se voit sans glisser : le 11 septembre
  // 2026, un bandeau à faire glisser a été redemandé pour les infos de l'église, et cette
  // liste a été choisie à la place avec Sébastien. Une ligne mène à son écran (« aller ») ou
  // à son lien (« url »). Chaque annonce s'efface d'elle-même le lendemain de son dernier
  // jour : « jusquAu » s'il est donné, sinon la dernière de ses « dates ».

  function dernierJour(annonce) {
    if (annonce.jusquAu) return annonce.jusquAu;
    return [...(annonce.dates || [])].sort().pop() || "";
  }

  // Le pavé montre la prochaine date : un forum sur deux dimanches affiche le second une fois
  // le premier passé. Sans date, une pastille d'information.
  function ligneAnnonce(annonce, aujourdhui) {
    const date = [...(annonce.dates || [])].sort().find((d) => d >= aujourdhui);
    const tete = date ? badgeDate(date) : pastille(INFO);
    const texte = html`
      <span class="a-venir__texte">
        <span class="a-venir__titre">${echapper(annonce.titre)}</span>
        ${annonce.texte ? html`<span class="a-venir__detail">${echapper(annonce.texte)}</span>` : ""}
      </span>`;
    if (annonce.url) {
      return html`<li><a class="a-venir__ligne" href="${echapper(annonce.url)}" target="_blank" rel="noopener">${tete}${texte}${EXTERIEUR}</a></li>`;
    }
    if (annonce.aller) {
      return html`<li><button type="button" class="a-venir__ligne" data-aller="${echapper(annonce.aller)}">${tete}${texte}${CHEVRON_DROIT}</button></li>`;
    }
    return html`<li><div class="a-venir__ligne">${tete}${texte}</div></li>`;
  }

  // « Formations à venir » : celles de l'église ouvertes aux jeunes, qui vont commencer. Elles
  // demandent une inscription : un jeune ne doit pas croire qu'il suffit de venir le jour
  // même. D'où une carte à part, « Inscription obligatoire » en tête — une simple mention,
  // sans panneau d'avertissement, à la demande de Sébastien — et un vrai bouton par
  // formation. Une formation disparaît le lendemain de sa première séance (ou de
  // « jusquAu », s'il est donné) : sur l'accueil, il n'y a que ce qui va arriver.

  function finInscription(formation) {
    return formation.jusquAu || [...(formation.dates || [])].sort()[0] || "";
  }

  function blocFormations() {
    const a = ui.accueil;
    const aujourdhui = aujourdhuiISO();
    const ouvertes = (infos.formations || []).filter((formation) => {
      const fin = finInscription(formation);
      return !fin || fin >= aujourdhui;
    });
    if (!ouvertes.length) return "";
    const lignes = ouvertes
      .map(
        (f) => html`
          <li class="formation">
            <h3 class="formation__titre">${echapper(f.titre)}</h3>
            ${f.quand ? html`<p class="formation__quand">${echapper(f.quand)}</p>` : ""}
            ${f.texte ? html`<p class="formation__texte">${echapper(f.texte)}</p>` : ""}
            <a class="bouton-principal formation__inscrire" href="${echapper(f.url)}" target="_blank" rel="noopener"
              aria-label="${echapper(remplir(a.inscrireA, { titre: f.titre }))}">${echapper(a.inscrire)} ${EXTERIEUR}</a>
          </li>
        `
      )
      .join("");
    return html`
      <section class="formations" aria-labelledby="titre-formations">
        <h2 class="formations__titre" id="titre-formations">${echapper(a.formations)}</h2>
        <p class="formations__mention">${echapper(a.inscriptionObligatoire)}</p>
        <ul class="formations__liste">${lignes}</ul>
      </section>
    `;
  }

  function blocAnnonces() {
    const a = ui.accueil;
    const aujourdhui = aujourdhuiISO();
    const cartes = [];
    const enCours = (infos.annonces || []).filter((annonce) => {
      const fin = dernierJour(annonce);
      return !fin || fin >= aujourdhui;
    });
    if (enCours.length) {
      cartes.push(html`
        <section class="a-venir" aria-labelledby="titre-a-venir">
          <h2 class="a-venir__entete" id="titre-a-venir">${echapper(a.aVenir)}</h2>
          <ul class="a-venir__liste">${enCours.map((annonce) => ligneAnnonce(annonce, aujourdhui)).join("")}</ul>
        </section>
      `);
    }
    return cartes.join("");
  }

  // Une étude que le jeune n'a pas encore ouverte : sa carte, avec un bouton pour y entrer.
  function blocNouvelleEtude() {
    const a = ui.accueil;
    const nouveau = index.sujets.find((s) => !lire("vu:sujet:" + s.id) && !sujetArchive(s.id));
    if (!nouveau) return "";
    return html`
      <article class="annonce annonce--nouveau">
        <p class="annonce__etiquette">${echapper(a.nouveauSujet)}</p>
        <h2 class="annonce__titre">${echapper(nouveau.titre)}</h2>
        ${nouveau.resume ? html`<p class="annonce__texte">${echapper(nouveau.resume)}</p>` : ""}
        ${boutonUne("sujet/" + nouveau.id, a.decouvrir)}
      </article>
    `;
  }

  // Glisser une carte de sujet vers la droite : le mot derrière se découvre, et si l'on va
  // assez loin, la carte file et le sujet change de liste. Le défilement vertical reste
  // celui de la page (touch-action: pan-y) : on ne prend la main que sur un geste
  // franchement horizontal.
  function brancherGlissements() {
    const SEUIL = 96; // en pixels : au-delà, lâcher archive ; en deçà, la carte revient
    principal.querySelectorAll(".glissable").forEach((ligne) => {
      const carte = ligne.querySelector(".fiche");
      let depart = null;
      let horizontal = null;
      let dx = 0;

      const suivre = (evenement) => {
        if (!depart) return;
        const ddx = evenement.clientX - depart.x;
        const ddy = evenement.clientY - depart.y;
        if (horizontal === null) {
          if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
          horizontal = Math.abs(ddx) > Math.abs(ddy);
          if (!horizontal) return terminer(false);
          ligne.setPointerCapture(evenement.pointerId);
          ligne.dataset.actif = "";
        }
        dx = Math.max(0, ddx);
        carte.style.transform = `translateX(${dx}px)`;
        if (dx >= SEUIL) ligne.dataset.pret = "";
        else delete ligne.dataset.pret;
      };

      const terminer = (valide) => {
        if (!depart) return;
        const fini = valide && horizontal && dx >= SEUIL;
        depart = null;
        horizontal = null;
        if (fini) {
          // La carte s'en va, puis la liste se refait.
          ligne.dataset.glisse = "";
          carte.style.transform = "translateX(110%)";
          carte.style.opacity = "0";
          const cle = "archive:sujet:" + ligne.dataset.sujet;
          setTimeout(() => {
            if (lire(cle)) effacer(cle);
            else ecrire(cle, new Date().toISOString().slice(0, 10));
            afficher();
          }, 180);
        } else {
          carte.style.transform = "";
          delete ligne.dataset.actif;
          delete ligne.dataset.pret;
          // Un simple toucher n'est pas un glissement : le clic passe. Un glissement avorté
          // ne doit pas ouvrir le sujet.
          if (dx > 8) {
            ligne.dataset.glisse = "";
            setTimeout(() => delete ligne.dataset.glisse, 300);
          }
        }
        dx = 0;
      };

      ligne.addEventListener("pointerdown", (evenement) => {
        if (evenement.pointerType === "mouse" && evenement.button !== 0) return;
        depart = { x: evenement.clientX, y: evenement.clientY };
        horizontal = null;
        dx = 0;
        carte.style.transition = "none";
      });
      ligne.addEventListener("pointermove", suivre);
      ligne.addEventListener("pointerup", () => {
        carte.style.transition = "";
        terminer(true);
      });
      ligne.addEventListener("pointercancel", () => {
        carte.style.transition = "";
        terminer(false);
      });
    });
  }

  // Les cartes des sujets et des défis servent à l'accueil (un aperçu) et à leur onglet
  // (la liste entière).
  function carteSujet(s, archive) {
    const a = ui.accueil;
    return carte({
      aller: "sujet/" + s.id,
      classe: archive ? "fiche--sujet fiche--archive" : "fiche--sujet",
      pastille: pastille(BULLE, archive ? "" : "fiche__pastille--vive"),
      titre: s.titre,
      sous: [s.sousTitre, s.questions ? s.questions + " questions" : ""].filter(Boolean).join(" · "),
      etiquette: archive || lire("vu:sujet:" + s.id) ? "" : a.nouveau,
      glissable: { sujet: s.id, etiquette: archive ? a.glisserRemettre : a.glisserArchiver },
    });
  }

  function carteDefi(d) {
    const faites = compterFaites(d.id);
    return carte({
      aller: "defi/" + d.id,
      classe: "fiche--defi",
      pastille: anneau(faites, d.etapes),
      titre: d.titre,
      sous: faites ? remplir(ui.defi.progression, { fait: faites, total: d.etapes }) : d.resume,
    });
  }

  function lienSection(aller, libelle) {
    return html`<button type="button" class="lien-section" data-aller="${echapper(aller)}">${echapper(libelle)} ${CHEVRON_DROIT}</button>`;
  }

  // ---------------------------------------------------------------------------
  // L'accueil : un aperçu de chaque section
  // ---------------------------------------------------------------------------
  //
  // Le bandeau, puis un extrait de chaque onglet : le sujet le plus récent, le défi en
  // cours, les trois prochaines rencontres. Chaque bloc mène à son onglet.

  // Dans cet ordre, voulu par Sébastien : le bandeau tout en haut, la prochaine rencontre,
  // les raccourcis en dernier. Aucun titre au-dessus d'une carte qui dit déjà ce qu'elle
  // est, et pas de logo : l'icône sur l'écran d'accueil du téléphone suffit.
  function ecranAccueil() {
    return html`
      ${blocBonjour()}
      ${blocALaUne()}
      ${blocRencontre()}
      ${blocAnnonces()}
      ${blocFormations()}
      ${blocNouvelleEtude()}
      ${blocRappel()}
      ${blocRaccourcis()}
    `;
  }

  // ---------------------------------------------------------------------------
  // Les onglets Sujets, Défis et Plus
  // ---------------------------------------------------------------------------

  function ecranSujets() {
    const a = ui.accueil;
    const actifs = index.sujets.filter((s) => !sujetArchive(s.id));
    const archives = index.sujets.filter((s) => sujetArchive(s.id));
    const sujets = actifs.length
      ? actifs.map((s) => carteSujet(s, false)).join("")
      : html`<li><p class="vide">${echapper(a.aucunSujet)}</p></li>`;
    const blocArchives = archives.length
      ? html`<details class="archives">
          <summary class="section-titre archives__titre">${echapper(a.archives)} (${archives.length})</summary>
          <ul class="fiches">${archives.map((s) => carteSujet(s, true)).join("")}</ul>
        </details>`
      : "";
    return html`
      <section class="page">
        <header class="page__entete"><h1 class="page__titre">${echapper(ui.sujets.titre)}</h1></header>
        <ul class="fiches">${sujets}</ul>
        ${blocArchives}
      </section>
    `;
  }

  function ecranDefis() {
    const defis = index.defis.length
      ? index.defis.map(carteDefi).join("")
      : html`<li><p class="vide">${echapper(ui.accueil.aucunDefi)}</p></li>`;
    return html`
      <section class="page">
        <header class="page__entete"><h1 class="page__titre">${echapper(ui.defis.titre)}</h1></header>
        <ul class="fiches">${defis}</ul>
      </section>
    `;
  }

  function ecranPlus() {
    const a = ui.accueil;
    return html`
      <section class="page">
        <header class="page__entete"><h1 class="page__titre">${echapper(ui.plus.titre)}</h1></header>
        <ul class="fiches">
          ${carte({ aller: "pratique", classe: "fiche--pratique", pastille: pastille(BOUSSOLE), titre: ui.pratique.titre })}
          ${carte({ aller: "decouvrir", classe: "fiche--ami", pastille: pastille(QR), titre: ui.plus.partager, sous: ui.plus.partagerSous })}
          ${carte({ aller: "sauvegarde", classe: "fiche--sauvegarde", pastille: pastille(SAUVEGARDE), titre: a.sauvegarde })}
          ${carte({ aller: "a-propos", classe: "fiche--a-propos", pastille: pastille(INFO), titre: a.aProposApp })}
          ${carte({ aller: "reglages", classe: "fiche--reglages", pastille: pastille(ENGRENAGE), titre: ui.plus.reglages })}
        </ul>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // La barre des sections, en bas
  // ---------------------------------------------------------------------------
  //
  // Cinq onglets, toujours sous le pouce : accueil, sujets, défis, agenda, plus. Elle est
  // là sur tous les écrans de l'application, sauf quand on écrit — le clavier prend la
  // place — et sur l'écran d'installation, qui n'a rien à proposer d'autre.

  const ONGLETS = [
    { nom: "accueil", aller: "", icone: () => LOGO_GDJ },
    { nom: "sujets", aller: "sujets", icone: () => BULLE },
    { nom: "defis", aller: "defis", icone: () => DRAPEAU },
    { nom: "agenda", aller: "agenda", icone: () => CALENDRIER },
    { nom: "plus", aller: "plus", icone: () => PLUS },
  ];

  // Si la page servie est une ancienne version sans barre (le temps d'une mise à jour), on
  // continue sans elle plutôt que d'arrêter l'application.
  function construireOnglets() {
    const nav = document.getElementById("onglets");
    if (!nav) return;
    nav.innerHTML = html`<div class="onglets__contenu">
      ${ONGLETS.map(
        (o) => html`<button type="button" class="onglet" data-onglet="${o.nom}" data-aller="${o.aller}">
          <span class="onglet__icone">${o.icone()}</span>
          <span class="onglet__nom">${echapper(ui.onglets[o.nom])}</span>
        </button>`
      ).join("")}
    </div>`;
  }

  // Quel onglet s'allume pour quel écran : l'intérieur d'un sujet allume « Sujets », un défi
  // « Défis », Pratique ou la sauvegarde « Plus ».
  function ongletDe(ecran) {
    if (ecran === "accueil") return "accueil";
    if (ecran === "sujets" || ecran === "sujet" || ecran.startsWith("sujet-") || ecran === "question") return "sujets";
    if (ecran === "defis" || ecran === "defi") return "defis";
    if (ecran === "agenda") return "agenda";
    return "plus";
  }

  function reglerOnglets(ecran) {
    const nav = document.getElementById("onglets");
    if (!nav) return;
    nav.hidden = ecran === "installation" || ecran === "question" || ecran === "sujet-notes";
    const actif = ongletDe(ecran);
    nav.querySelectorAll(".onglet").forEach((bouton) => {
      if (bouton.dataset.onglet === actif) bouton.setAttribute("aria-current", "page");
      else bouton.removeAttribute("aria-current");
    });
  }

  // ---------------------------------------------------------------------------
  // Un sujet : une liste de fiches, et l'on entre dans chacune
  // ---------------------------------------------------------------------------
  //
  // Pas de parcours imposé — un sujet se remplit avant, pendant et après une rencontre, et
  // l'on doit pouvoir reprendre n'importe quelle question à n'importe quel moment. Sur
  // cette liste, chaque question ne porte que son texte : ni coche, ni « validé ».

  function ecranSujet(sujet) {
    const s = ui.sujet;
    const base = "sujet/" + sujet.id + "/";

    const questions = sujet.questions
      .map(
        (question, i) => html`
          <li>
            <button type="button" class="fiche fiche--question" data-aller="${base}q${i + 1}">
              <span class="fiche__numero">${i + 1}</span>
              <span class="fiche__texte">
                <span class="fiche__titre">${echapper(question.texte)}</span>
              </span>
              ${CHEVRON_DROIT}
            </button>
          </li>
        `
      )
      .join("");

    const versets = sujet.versets && sujet.versets.textes && sujet.versets.textes.length
      ? carte({ aller: base + "versets", classe: "fiche--versets", pastille: pastille(BIBLE, "fiche__pastille--vive"), titre: sujet.versets.titre || s.inspiration })
      : "";

    const archive = sujetArchive(sujet.id);

    return html`
      <section class="page">
        <header class="page__entete">
          ${archive ? html`<span class="etiquette">${echapper(s.archive)}</span>` : ""}
          <h1 class="page__titre">${echapper(sujet.titre)}</h1>
          ${sujet.sousTitre ? html`<p class="page__soustitre">${echapper(sujet.sousTitre)}</p>` : ""}
        </header>

        <ul class="fiches">
          ${carte({ aller: base + "a-propos", classe: "fiche--a-propos", pastille: pastille(INFO), titre: s.aPropos })}
        </ul>

        <h2 class="section-titre">${echapper(s.questions)}</h2>
        <ul class="fiches">${questions}</ul>
        <ul class="fiches">${versets}</ul>

        <h2 class="section-titre">${echapper(s.reflexions)}</h2>
        <ul class="fiches">
          <li>
            <button type="button" class="fiche fiche--notes" data-aller="${base}notes">
              <span class="fiche__pastille fiche__pastille--emoji" aria-hidden="true">🤔</span>
              <span class="fiche__texte"><span class="fiche__titre">${echapper(s.reflexions)}</span></span>
              ${CHEVRON_DROIT}
            </button>
          </li>
        </ul>

        <h2 class="section-titre">${echapper(s.partager)}</h2>
        <ul class="fiches">
          ${carte({ aller: base + "partager", classe: "fiche--partager", pastille: pastille(PARTAGE, "fiche__pastille--vive"), titre: s.partagerReponses })}
        </ul>

        <div class="sujet__archive">
          <p class="sujet__archive-aide">${echapper(archive ? s.desarchiverAide : s.archiverAide)}</p>
          <button type="button" class="bouton-secondaire" data-archiver="${echapper(sujet.id)}">${echapper(archive ? s.desarchiver : s.archiver)}</button>
        </div>
      </section>
    `;
  }

  function ecranSujetAPropos(sujet) {
    const a = ui.aPropos;
    const sections = (sujet.intro || [])
      .map(
        (partie) => html`
          <p>${echapper(partie.texte)}</p>
          ${partie.points && partie.points.length ? html`<ul>${partie.points.map((point) => html`<li>${echapper(point)}</li>`).join("")}</ul>` : ""}
        `
      )
      .join("");
    const fiche = sujet.fiche || {};

    return html`
      <section class="page">
        <header class="page__entete">
          <h1 class="page__titre">${echapper(fiche.titre || sujet.titre)}</h1>
          <p class="page__soustitre">${echapper(fiche.sousTitre || sujet.sousTitre || "")}</p>
        </header>
        ${sections ? html`<div class="page__contenu">${sections}</div>` : ""}
        ${sujet.avertissement ? html`<p class="avertissement">${echapper(sujet.avertissement)}</p>` : ""}
        <p class="a-propos__confidentialite">${echapper(a.confidentialite)}</p>
      </section>
    `;
  }

  function ecranVersets(sujet) {
    const v = sujet.versets;
    const textes = v.textes
      .map(
        (verset) => html`<blockquote class="verset">
          <span class="verset__reference">${echapper(verset.reference)}</span>
          <p class="verset__texte">${echapper(verset.texte)}</p>
        </blockquote>`
      )
      .join("");

    return html`
      <section class="page">
        <div class="page__contenu">
          ${textes}
          ${v.traduction ? html`<p class="versets__source">${echapper(v.traduction)}</p>` : ""}
        </div>
      </section>
    `;
  }

  // Le même écran pour une question et pour les réflexions libres : un intitulé, la place
  // d'écrire, et la mention « Enregistré » qui passe à chaque frappe.
  function ecranEcriture(cle, intitule, placeholder) {
    const texte = lire(cle) || "";
    return html`
      <section class="question" aria-labelledby="intitule">
        <h1 class="question__intitule" id="intitule">${echapper(intitule)}</h1>
        <textarea
          class="question__reponse"
          id="zone-${echapper(cle).replace(/[^a-zA-Z0-9-]/g, "-")}"
          data-cle="${echapper(cle)}"
          aria-labelledby="intitule"
          placeholder="${echapper(placeholder)}"
        >${echapper(texte)}</textarea>
        <p class="question__pied">
          <span class="question__etat" data-etat="${echapper(cle)}" role="status">${echapper(ui.sujet.enregistre)}</span>
        </p>
      </section>
    `;
  }

  function cleQuestion(sujet, question) {
    return "sujet:" + sujet.id + ":" + question.id;
  }

  function ecranQuestion(sujet, indexQuestion) {
    const question = sujet.questions[indexQuestion];
    return ecranEcriture(cleQuestion(sujet, question), question.texte, ui.sujet.placeholder);
  }

  function ecranNotes(sujet) {
    const n = ui.sujet.notes;
    return ecranEcriture("sujet:" + sujet.id + ":notes", n.titre, n.placeholder);
  }

  function ecranPartager(sujet) {
    const s = ui.sujet.partage;
    const prenom = lire("prenom") || "";
    // Un seul bouton, un seul libellé. Là où le téléphone sait partager, il ouvre son menu de
    // partage ; là où ce menu n'existe pas (un ordinateur), il copie le texte et la ligne de
    // confirmation le dit. Le libellé ne change pas : c'est le même geste.
    return html`
      <section class="page">
        <div class="page__contenu">
          <p class="partage__texte">${echapper(s.texte)}</p>
          <p class="partage__comment">${echapper(s.comment)}</p>
          <label class="champ">
            <span class="champ__intitule">${echapper(s.prenom)}</span>
            <input
              class="champ__saisie"
              type="text"
              id="prenom"
              value="${echapper(prenom)}"
              autocomplete="given-name"
              placeholder="${echapper(s.prenomAide)}"
            />
          </label>
          <button type="button" class="bouton-principal" id="partager" data-sujet="${echapper(sujet.id)}">${echapper(s.bouton)}</button>
          <p class="confirmation" id="confirmation-envoi" role="status"></p>
        </div>
      </section>
    `;
  }

  // Un seul message, lisible tel quel par qui le reçoit : le titre, le prénom, puis chaque
  // question suivie de sa réponse, et les réflexions libres à la fin si elles existent.
  // Rien d'autre que du texte : il doit passer tel quel par WhatsApp, un courriel ou un SMS.
  function texteDesReponses(sujet) {
    const m = ui.sujet.message;
    // Le champ d'abord, la mémoire ensuite : ce qui est sous les yeux au moment d'appuyer
    // doit partir, même si l'enregistrement n'a pas encore eu lieu.
    const champ = document.getElementById("prenom");
    const prenom = ((champ ? champ.value : null) ?? lire("prenom") ?? "").trim();
    const notes = (lire("sujet:" + sujet.id + ":notes") || "").trim();
    const ligne = "━━━━━━━━━━━━━━━━━━";
    const lignes = [sujet.titre.toUpperCase()];
    if (sujet.sousTitre) lignes.push(sujet.sousTitre);
    if (prenom) lignes.push(remplir(m.reponsesDe, { prenom }));
    lignes.push(ligne, "");

    sujet.questions.forEach((question, i) => {
      const reponse = (lire(cleQuestion(sujet, question)) || "").trim();
      lignes.push(i + 1 + ". " + question.texte, "", reponse || m.sansReponse, "", ligne, "");
    });

    if (notes) lignes.push(m.notes, "", notes, "", ligne);

    return lignes.join("\n").trim();
  }

  // ---------------------------------------------------------------------------
  // Un défi ou une lecture : des étapes à cocher
  // ---------------------------------------------------------------------------

  function ecranDefi(defi) {
    const d = ui.defi;
    const etat = lireDefi(defi.id);
    const total = defi.etapes.length;
    const faites = defi.etapes.filter((e) => etat.faites[e.id]).length;

    const etapes = defi.etapes
      .map((etape) => {
        const faite = Boolean(etat.faites[etape.id]);
        const note = etat.notes[etape.id] || "";
        return html`
          <li class="etape ${faite ? "etape--faite" : ""}" data-etape-ligne="${echapper(etape.id)}">
            <label class="etape__ligne">
              <input type="checkbox" class="etape__case" data-defi="${echapper(defi.id)}" data-etape="${echapper(etape.id)}" ${faite ? "checked" : ""} />
              <span class="etape__coche" aria-hidden="true">${COCHE}</span>
              <span class="etape__texte">
                <span class="etape__titre">${echapper(etape.titre)}</span>
                ${etape.detail ? html`<span class="etape__detail">${echapper(etape.detail)}</span>` : ""}
              </span>
            </label>
            ${etape.texte ? html`<p class="etape__verset">${echapper(etape.texte)}</p>` : ""}
            ${etape.saisie
              ? html`<input
                  type="text"
                  class="etape__note"
                  data-defi="${echapper(defi.id)}"
                  data-note="${echapper(etape.id)}"
                  value="${echapper(note)}"
                  placeholder="${echapper(d.notePlaceholder)}"
                  aria-label="${echapper(etape.titre)}"
                />`
              : ""}
          </li>
        `;
      })
      .join("");

    return html`
      <section class="page">
        <header class="page__entete">
          <span class="etiquette">${echapper(defi.type === "lecture" ? d.lecture : d.defi)}</span>
          <h1 class="page__titre">${echapper(defi.titre)}</h1>
          <p class="page__soustitre" id="progression-${echapper(defi.id)}">${echapper(texteProgression(faites, total))}</p>
          <div class="jauge" aria-hidden="true"><div class="jauge__part" id="jauge-${echapper(defi.id)}" style="width: ${total ? Math.round((faites / total) * 100) : 0}%"></div></div>
        </header>
        ${defi.description ? html`<div class="page__contenu"><p>${echapper(defi.description)}</p></div>` : ""}
        <ul class="etapes">${etapes}</ul>
        ${defi.traduction ? html`<p class="versets__source versets__source--defi">${echapper(defi.traduction)}</p>` : ""}
        <button type="button" class="bouton-secondaire" data-recommencer="${echapper(defi.id)}">${echapper(d.recommencer)}</button>
        <p class="confirmation" id="confirmation-defi" role="status"></p>
      </section>
    `;
  }

  function texteProgression(faites, total) {
    const d = ui.defi;
    if (!faites) return d.pasCommence;
    if (faites >= total) return d.termine;
    return remplir(d.progression, { fait: faites, total });
  }

  function rafraichirProgression(defi) {
    const etat = lireDefi(defi.id);
    const total = defi.etapes.length;
    const faites = defi.etapes.filter((e) => etat.faites[e.id]).length;
    const ligne = document.getElementById("progression-" + defi.id);
    const jauge = document.getElementById("jauge-" + defi.id);
    if (ligne) ligne.textContent = texteProgression(faites, total);
    if (jauge) jauge.style.width = (total ? Math.round((faites / total) * 100) : 0) + "%";
  }

  // ---------------------------------------------------------------------------
  // L'agenda
  // ---------------------------------------------------------------------------

  function ecranAgenda() {
    const a = ui.agenda;
    const aVenir = evenementsAVenir();
    const passes = evenementsPasses();
    return html`
      <section class="page">
        <header class="page__entete"><h1 class="page__titre">${echapper(a.titre)}</h1></header>
        <h2 class="section-titre">${echapper(a.aVenir)}</h2>
        ${aVenir.length
          ? html`<ul class="evenements">${aVenir.map((e) => ligneEvenement(e, { detail: true, calendrier: true })).join("")}</ul>`
          : html`<p class="vide">${echapper(a.rien)}</p>`}
        ${passes.length
          ? html`<details class="passes">
              <summary class="section-titre passes__titre">${echapper(a.passe)}</summary>
              <ul class="evenements evenements--passes">${passes.map((e) => ligneEvenement(e)).join("")}</ul>
            </details>`
          : ""}
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Pratique : les liens utiles
  // ---------------------------------------------------------------------------

  function lienExterne(lien) {
    return html`
      <li>
        <a class="fiche fiche--lien" href="${echapper(lien.url)}" target="_blank" rel="noopener">
          <span class="fiche__pastille">${EXTERIEUR}</span>
          <span class="fiche__texte">
            <span class="fiche__titre">${echapper(lien.titre)}</span>
            ${lien.description ? html`<span class="fiche__sous">${echapper(lien.description)}</span>` : ""}
          </span>
          ${CHEVRON_DROIT}
        </a>
      </li>
    `;
  }

  // Des sections, chacune avec un titre, un texte facultatif et ses liens. Le contenu
  // décide de tout ; le code ne connaît aucune rubrique à l'avance.
  function ecranPratique() {
    const p = ui.pratique;
    const sections = (pratique.sections || (pratique.liens ? [{ titre: p.liens, liens: pratique.liens }] : []))
      .map(
        (section) => html`
          <h2 class="section-titre">${echapper(section.titre)}</h2>
          ${section.texte ? html`<div class="page__contenu page__contenu--serre"><p>${echapper(section.texte)}</p></div>` : ""}
          <ul class="fiches">${(section.liens || []).map(lienExterne).join("")}</ul>
        `
      )
      .join("");
    const contact = pratique.contact || {};

    return html`
      <section class="page">
        ${sections}
        ${contact.texte
          ? html`<h2 class="section-titre">${echapper(p.contact)}</h2>
              <div class="page__contenu">
                <p>${echapper(contact.texte)}</p>
                ${contact.whatsapp ? html`<a class="bouton-principal bouton-principal--lien" href="${echapper(contact.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
              </div>`
          : ""}
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // À propos de l'application, et la faire découvrir
  // ---------------------------------------------------------------------------

  function ecranAPropos() {
    const a = ui.aPropos;
    return html`
      <section class="page">
        <div class="page__contenu">
          ${(a.texte || []).map((t) => html`<p>${echapper(t)}</p>`).join("")}
        </div>
        <p class="a-propos__confidentialite">${echapper(a.confidentialite)}</p>
        <p class="a-propos__attention">${INFO} ${echapper(a.attention)}</p>
      </section>
    `;
  }

  // Le lien circule surtout de jeune à jeune. Le QR code affiché ici est le même que celui
  // qu'on imprime : un ami le scanne avec son appareil photo et tombe sur l'installation.
  function ecranDecouvrir() {
    const q = ui.aPropos.qr;
    const adresse = location.origin + location.pathname;
    return html`
      <section class="page">
        <div class="page__contenu qr">
          <p class="qr__texte">${echapper(q.texte)}</p>
          <img class="qr__image" src="qr-gdj.png" alt="Code à scanner menant à ${echapper(adresse)}" width="320" height="320" />
          <p class="qr__adresse" id="lien-app">${echapper(adresse)}</p>
          <button type="button" class="bouton-principal" id="partager-lien">${echapper(q.bouton)}</button>
          <p class="confirmation" id="confirmation-lien-app" role="status"></p>
        </div>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Sauvegarder et restaurer
  // ---------------------------------------------------------------------------
  //
  // Sans serveur, les réponses n'existent que sur le téléphone. La sauvegarde est le filet :
  // un fichier que la personne garde où elle veut, et qu'elle peut remettre dans
  // l'application sur un autre téléphone. Elle contient tout ce que l'application a
  // enregistré — réponses, réflexions, étapes cochées, lignes écrites, prénom.

  function ecranSauvegarde() {
    const s = ui.sauvegarde;
    const derniere = lire("sauvegarde-date");
    const ligneDerniere = derniere ? remplir(s.derniere, { date: formaterDateHeure(new Date(derniere)) }) : s.jamais;
    return html`
      <section class="page">
        <div class="page__contenu">
          <p class="partage__texte">${echapper(s.texte)}</p>
          <button type="button" class="bouton-principal" id="sauvegarder">${echapper(s.bouton)}</button>
          <p class="sauvegarde__derniere" id="derniere-sauvegarde">${echapper(ligneDerniere)}</p>
          <p class="confirmation" id="confirmation-sauvegarde" role="status"></p>
        </div>
        <h2 class="section-titre">${echapper(s.restaurerTitre)}</h2>
        <div class="page__contenu">
          <p class="partage__texte">${echapper(s.restaurerTexte)}</p>
          <label class="bouton-secondaire bouton-fichier">
            ${echapper(s.restaurer)}
            <input type="file" id="restaurer" accept="application/json,.json" />
          </label>
          <p class="confirmation" id="confirmation-restauration" role="status"></p>
        </div>
      </section>
    `;
  }

  function donneesASauvegarder() {
    const donnees = {};
    for (const cle of clesEnregistrees()) {
      if (cle === "sauvegarde-date") continue;
      donnees[cle] = lire(cle);
    }
    return donnees;
  }

  async function sauvegarder() {
    const s = ui.sauvegarde;
    const confirmation = document.getElementById("confirmation-sauvegarde");
    const donnees = donneesASauvegarder();
    if (!Object.keys(donnees).length) {
      confirmation.textContent = s.rien;
      return;
    }
    const maintenant = new Date();
    const contenu = JSON.stringify({ application: "gdj-ebtm", version: 1, date: maintenant.toISOString(), donnees }, null, 2);
    const nom = `${s.nomFichier}-${maintenant.toISOString().slice(0, 10)}.json`;
    const fichier = new File([contenu], nom, { type: "application/json" });

    // Le menu de partage du téléphone, quand il accepte les fichiers : la personne choisit
    // où le garder — Fichiers, Mail, un message à elle-même. Sinon, un téléchargement.
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      try {
        // Le fichier seul : un titre ajouté ici devient, sur iPhone, un second fichier
        // « texte » enregistré à côté de la sauvegarde. Vu sur le simulateur.
        await navigator.share({ files: [fichier] });
      } catch (erreur) {
        if (erreur && erreur.name === "AbortError") return; // partage annulé : on ne dit rien
        confirmation.textContent = s.echec;
        return;
      }
    } else {
      const lien = document.createElement("a");
      lien.href = URL.createObjectURL(new Blob([contenu], { type: "application/json" }));
      lien.download = nom;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
    }

    ecrire("sauvegarde-date", maintenant.toISOString());
    confirmation.textContent = s.faite;
    const derniere = document.getElementById("derniere-sauvegarde");
    if (derniere) derniere.textContent = remplir(s.derniere, { date: formaterDateHeure(maintenant) });
  }

  async function restaurer(fichier) {
    const s = ui.sauvegarde;
    const confirmation = document.getElementById("confirmation-restauration");
    let sauvegarde;
    try {
      sauvegarde = JSON.parse(await fichier.text());
    } catch {
      confirmation.textContent = s.invalide;
      return;
    }
    if (!sauvegarde || sauvegarde.application !== "gdj-ebtm" || typeof sauvegarde.donnees !== "object") {
      confirmation.textContent = s.invalide;
      return;
    }
    let nombre = 0;
    for (const [cle, valeur] of Object.entries(sauvegarde.donnees)) {
      if (typeof valeur !== "string") continue;
      if (ecrire(cle, valeur)) nombre++;
    }
    appliquerTaille(lire("taille") || "1");
    confirmation.textContent = remplir(s.restaure, { n: nombre });
  }

  // ---------------------------------------------------------------------------
  // Affichage
  // ---------------------------------------------------------------------------

  // La barre du haut n'existe que sur les écrans intérieurs : une flèche pour revenir, et
  // le nom de l'écran, comme dans toute application de téléphone. La flèche remonte d'un
  // niveau : d'une question à son sujet, d'un sujet à l'onglet Sujets. Sur l'accueil et les
  // onglets, il n'y a pas de barre du tout. Décidé par Sébastien le 11 septembre 2026.
  function regler_barre(titre, retourVers) {
    const entete = document.querySelector(".entete");
    const retour = document.getElementById("retour");
    const titreBarre = document.getElementById("titre-ecran");
    if (titre !== null) {
      entete.hidden = false;
      document.body.dataset.entete = "oui";
      retour.hidden = false;
      retour.dataset.retour = retourVers || "";
      titreBarre.hidden = false;
      titreBarre.textContent = titre;
    } else {
      entete.hidden = true;
      document.body.dataset.entete = "non";
      retour.hidden = true;
      retour.dataset.retour = "";
      titreBarre.hidden = true;
      titreBarre.textContent = "";
    }
  }

  function montrer(rendu, titre, retourVers) {
    transition(() => {
      regler_barre(titre, retourVers);
      principal.innerHTML = rendu;
      const zone = principal.querySelector(".question__reponse");
      if (zone) ajusterHauteur(zone);
      brancherGlissements();
    });
    // Après le rendu, et non pendant : Safari remet parfois la page à sa position précédente
    // au changement d'adresse, ce qui ouvrait une question déjà défilée, son titre sous la
    // barre. On repasse en haut une fois que tout est en place.
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  let sujetCourant = null;
  let defiCourant = null;

  async function afficher() {
    if (!ui || !index) return;

    // Un ordinateur n'a qu'un écran, le renvoi vers le téléphone : même avec « ?app », même
    // si Chrome l'a installée, l'application ne s'y ouvre jamais.
    if (!surTelephone()) {
      document.body.dataset.ecran = "installation";
      reglerOnglets("installation");
      regler_barre(null, "");
      principal.innerHTML = ecranOrdinateur();
      return;
    }

    // Une seule porte. Le lien et le QR code ne mènent qu'à l'installation, sur quelque
    // téléphone qu'on les ouvre : l'application se remplit sur toute l'année, et un
    // navigateur qu'on referme emporte les réponses avec lui. Seule l'application installée
    // montre l'accueil.
    if (!dejaInstallee()) {
      document.body.dataset.ecran = "installation";
      reglerOnglets("installation");
      regler_barre(null, "");
      principal.innerHTML = ecranInstallation();
      return;
    }

    const route = routeCourante();
    document.body.dataset.ecran = route.ecran;
    reglerOnglets(route.ecran);
    sujetCourant = null;
    defiCourant = null;

    try {
      if (route.ecran === "sujet" || route.ecran.startsWith("sujet-") || route.ecran === "question") {
        const entree = index.sujets.find((s) => s.id === route.id);
        if (!entree) return aller("");
        const sujet = await charger(entree.fichier);
        sujetCourant = sujet;
        const base = "sujet/" + sujet.id;
        const s = ui.sujet;
        if (route.ecran === "sujet") {
          ecrire("vu:sujet:" + sujet.id, "1");
          montrer(ecranSujet(sujet), sujet.titre, "sujets");
        } else if (route.ecran === "sujet-a-propos") {
          montrer(ecranSujetAPropos(sujet), s.aPropos, base);
        } else if (route.ecran === "sujet-versets") {
          montrer(ecranVersets(sujet), (sujet.versets && sujet.versets.titre) || s.inspiration, base);
        } else if (route.ecran === "sujet-notes") {
          montrer(ecranNotes(sujet), s.notes.titre, base);
        } else if (route.ecran === "sujet-partager") {
          montrer(ecranPartager(sujet), s.partage.titre, base);
        } else {
          if (!sujet.questions[route.index]) return aller(base);
          montrer(ecranQuestion(sujet, route.index), s.question + " " + (route.index + 1), base);
        }
        return;
      }

      if (route.ecran === "defi") {
        const entree = index.defis.find((d) => d.id === route.id);
        if (!entree) return aller("");
        const defi = await charger(entree.fichier);
        defiCourant = defi;
        montrer(ecranDefi(defi), defi.type === "lecture" ? ui.defi.lecture : ui.defi.defi, "defis");
        return;
      }
    } catch {
      montrer(html`<p class="message message--erreur">${echapper(ui.erreurChargement)}</p>`, "", "");
      return;
    }

    // Les onglets : pas de barre du haut, donc pas de flèche de retour.
    if (route.ecran === "sujets") return montrer(ecranSujets(), null, "");
    if (route.ecran === "defis") return montrer(ecranDefis(), null, "");
    if (route.ecran === "agenda") return montrer(ecranAgenda(), null, "");
    if (route.ecran === "plus") return montrer(ecranPlus(), null, "");
    // Les écrans de « Plus », avec leur flèche qui y ramène.
    if (route.ecran === "pratique") return montrer(ecranPratique(), ui.pratique.titre, "plus");
    if (route.ecran === "a-propos") return montrer(ecranAPropos(), ui.aPropos.titre, "plus");
    // « Partage l'appli » : sorti d'À propos le 11 septembre 2026 pour être à portée, sous Plus.
    if (route.ecran === "decouvrir") return montrer(ecranDecouvrir(), ui.plus.partager, "plus");
    if (route.ecran === "sauvegarde") return montrer(ecranSauvegarde(), ui.sauvegarde.titre, "plus");
    if (route.ecran === "reglages") return montrer(ecranReglages(), ui.reglages.titre, "plus");

    montrer(avertissementStockage() + bandeauNavigateur() + ecranAccueil(), null, "");
  }

  window.addEventListener("hashchange", afficher);
  // Chaque écran commence en haut ; le navigateur n'a pas à restaurer un défilement.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // ---------------------------------------------------------------------------
  // Saisie et enregistrement
  // ---------------------------------------------------------------------------

  // La zone grandit avec le texte : sur un téléphone, faire défiler l'intérieur d'un cadre
  // pendant qu'on écrit est pénible, et on ne relit pas ce qu'on vient de taper.
  function ajusterHauteur(zone) {
    zone.style.height = "auto";
    zone.style.height = Math.max(zone.scrollHeight, zone.parentElement.clientHeight * 0.4) + "px";
  }

  const minuteries = new Map();

  function signalerEnregistrement(cle) {
    const etat = principal.querySelector(`[data-etat="${CSS.escape(cle)}"]`);
    if (!etat) return;
    etat.dataset.visible = "oui";
    clearTimeout(minuteries.get(cle));
    minuteries.set(
      cle,
      setTimeout(() => {
        etat.dataset.visible = "non";
      }, 2000)
    );
  }

  document.addEventListener("input", (evenement) => {
    const cible = evenement.target;

    if (cible.matches(".question__reponse")) {
      ajusterHauteur(cible);
      const cle = cible.dataset.cle;
      if (ecrire(cle, cible.value)) signalerEnregistrement(cle);
      return;
    }

    if (cible.matches(".etape__note")) {
      const etat = lireDefi(cible.dataset.defi);
      if (cible.value.trim()) etat.notes[cible.dataset.note] = cible.value;
      else delete etat.notes[cible.dataset.note];
      ecrireDefi(cible.dataset.defi, etat);
      return;
    }

    if (cible.id === "prenom") ecrire("prenom", cible.value);
  });

  // Cocher une étape : on l'enregistre, on met la ligne à jour, on recompte.
  document.addEventListener("change", (evenement) => {
    const cible = evenement.target;
    if (cible.matches(".etape__case")) {
      const etat = lireDefi(cible.dataset.defi);
      if (cible.checked) etat.faites[cible.dataset.etape] = new Date().toISOString().slice(0, 10);
      else delete etat.faites[cible.dataset.etape];
      ecrireDefi(cible.dataset.defi, etat);
      const ligne = cible.closest(".etape");
      if (ligne) ligne.classList.toggle("etape--faite", cible.checked);
      if (defiCourant && defiCourant.id === cible.dataset.defi) rafraichirProgression(defiCourant);
      return;
    }

    if (cible.id === "restaurer" && cible.files && cible.files[0]) {
      restaurer(cible.files[0]);
      cible.value = "";
    }
  });

  // ---------------------------------------------------------------------------
  // Boutons : un seul écouteur pour tous
  // ---------------------------------------------------------------------------

  document.addEventListener("click", async (evenement) => {
    // Le clic qui suit un glissement de carte n'en est pas un.
    if (evenement.target.closest(".glissable[data-glisse]")) return;

    const destination = evenement.target.closest("[data-aller]");
    if (destination) {
      aller(destination.dataset.aller);
      return;
    }

    const retour = evenement.target.closest("#retour");
    if (retour) {
      aller(retour.dataset.retour || "");
      return;
    }

    if (evenement.target.closest("#sauvegarder")) {
      sauvegarder();
      return;
    }

    if (evenement.target.closest("[data-bienvenue]")) {
      ecrire("bienvenue-vue", new Date().toISOString().slice(0, 10));
      afficher();
      return;
    }

    // Archiver un sujet, ou le ressortir. Rien n'est effacé : seule la place change.
    const archiver = evenement.target.closest("[data-archiver]");
    if (archiver) {
      const cle = "archive:sujet:" + archiver.dataset.archiver;
      if (lire(cle)) effacer(cle);
      else ecrire(cle, new Date().toISOString().slice(0, 10));
      afficher();
      return;
    }

    // Recommencer un défi : deux temps, un doigt qui glisse ne doit pas suffire.
    const recommencer = evenement.target.closest("[data-recommencer]");
    if (recommencer) {
      const d = ui.defi;
      if (recommencer.dataset.confirme !== "oui") {
        recommencer.dataset.confirme = "oui";
        recommencer.textContent = d.confirmerRecommencer;
        return;
      }
      effacer("defi:" + recommencer.dataset.recommencer);
      document.getElementById("confirmation-defi").textContent = d.recommence;
      afficher();
      return;
    }

    if (evenement.target.closest("#partager") && sujetCourant) {
      const s = ui.sujet.partage;
      const texte = texteDesReponses(sujetCourant);
      const confirmation = document.getElementById("confirmation-envoi");
      if (navigator.share) {
        try {
          await navigator.share({ title: sujetCourant.titre, text: texte });
          confirmation.textContent = "";
        } catch (erreur) {
          // Un partage annulé n'est pas une erreur : on ne dit rien.
          if (erreur && erreur.name !== "AbortError") confirmation.textContent = s.echec;
        }
        return;
      }
      // Pas de menu de partage (un ordinateur) : on copie le message tout formaté. Si le
      // presse-papiers est refusé, le message s'affiche à l'écran, sélectionné, pour être
      // copié à la main : rien ne doit échouer en silence.
      try {
        await navigator.clipboard.writeText(texte);
        confirmation.textContent = s.copie;
      } catch {
        confirmation.textContent = s.aLaMain;
        let zone = document.getElementById("message-a-copier");
        if (!zone) {
          zone = document.createElement("textarea");
          zone.id = "message-a-copier";
          zone.className = "partage__secours";
          zone.readOnly = true;
          zone.setAttribute("aria-label", s.aLaMain);
          confirmation.after(zone);
        }
        zone.value = texte;
        zone.focus();
        zone.select();
      }
      return;
    }

    // Envoyer le lien de l'application à un ami : le menu de partage du téléphone quand il
    // existe, sinon la copie, et à défaut l'adresse sélectionnée pour être recopiée.
    if (evenement.target.closest("#partager-lien")) {
      const q = ui.aPropos.qr;
      const adresse = location.origin + location.pathname;
      const zone = document.getElementById("confirmation-lien-app");
      if (navigator.share) {
        try {
          await navigator.share({ title: ui.application.nom, text: q.message, url: adresse });
        } catch (erreur) {
          if (erreur && erreur.name !== "AbortError") zone.textContent = ui.sujet.partage.echec;
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(adresse);
        zone.textContent = q.copie;
      } catch {
        selectionner(document.getElementById("lien-app"));
        zone.textContent = q.aLaMain;
      }
      return;
    }

    // Copier le lien plutôt que de demander de le recopier : dans une fenêtre interne
    // d'application, la barre d'adresse est souvent absente ou non sélectionnable.
    if (evenement.target.closest("#copier-lien")) {
      const s = ui.installation.secours;
      const zone = document.getElementById("confirmation-lien");
      try {
        await navigator.clipboard.writeText(location.origin + location.pathname);
        zone.textContent = s.confirmation;
      } catch {
        selectionner(document.getElementById("lien-installation"));
        zone.textContent = s.aLaMain;
      }
      return;
    }

    // Le bouton d'installation du navigateur.
    const invite = evenement.target.closest('[data-invite="installer"]');
    if (invite && installationDifferee) {
      installationDifferee.prompt();
      const { outcome } = await installationDifferee.userChoice;
      // prompt() ne se rappelle pas sur le même événement : le navigateur en émettra un nouveau.
      installationDifferee = null;
      if (outcome !== "accepted") afficher();
    }
  });

  function selectionner(element) {
    if (!element) return;
    const plage = document.createRange();
    plage.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(plage);
  }

  // ---------------------------------------------------------------------------
  // Réglages : un écran comme les autres, sous « Plus »
  // ---------------------------------------------------------------------------
  //
  // D'abord une fenêtre par-dessus l'écran ; un vrai écran depuis le 11 septembre 2026, à la
  // demande de Sébastien, pour avoir la place d'y ranger le prénom, le rappel de sauvegarde
  // et la version.

  // Ce que « Effacer toutes mes réponses » garde : des réglages, pas des réponses.
  const REGLAGES_GARDES = ["taille", "rappel-sauvegarde"];

  let messageReglages = ""; // montré une fois, à l'affichage qui suit un effacement
  let versionInstallee = ""; // lue au démarrage, voir lireVersionInstallee()

  // La version se lit dans le nom du cache du service worker (« gdj-<VERSION> ») : c'est
  // celle que le téléphone a vraiment, sans fichier de plus à tenir à jour.
  function lireVersionInstallee() {
    if (!("caches" in window)) return;
    caches
      .keys()
      .then((noms) => {
        const versions = noms.filter((nom) => nom.startsWith("gdj-")).map((nom) => nom.slice("gdj-".length));
        versions.sort((a, b) => b.localeCompare(a, "fr", { numeric: true }));
        versionInstallee = versions[0] || "";
      })
      .catch(() => {});
  }

  function ecranReglages() {
    const r = ui.reglages;
    const taille = lire("taille") || "1";
    const rappel = lire("rappel-sauvegarde") === "jamais" ? "jamais" : "mois";
    const crans = TAILLES.map(
      (t) => html`<button type="button" class="cran" data-taille="${t.valeur}" aria-pressed="${t.valeur === taille}">${t.nom}</button>`
    ).join("");
    const choixRappel = [
      ["mois", r.rappelMois],
      ["jamais", r.rappelJamais],
    ]
      .map(([valeur, nom]) => html`<button type="button" class="cran" data-rappel="${valeur}" aria-pressed="${valeur === rappel}">${echapper(nom)}</button>`)
      .join("");
    const message = messageReglages;
    messageReglages = "";
    return html`
      <section class="page">
        <div class="page__contenu">
          <div class="reglage">
            <label class="reglage__intitule" for="prenom">${echapper(r.prenom)}</label>
            <input class="champ__saisie" type="text" id="prenom" value="${echapper(lire("prenom") || "")}"
              autocomplete="given-name" maxlength="40" aria-describedby="aide-prenom" />
            <p class="reglage__aide" id="aide-prenom">${echapper(r.prenomAide)}</p>
          </div>
          <div class="reglage">
            <span class="reglage__intitule" id="intitule-taille">${echapper(r.taille)}</span>
            <div class="crans" role="group" aria-labelledby="intitule-taille">${crans}</div>
          </div>
          <div class="reglage">
            <span class="reglage__intitule" id="intitule-rappel">${echapper(r.rappel)}</span>
            <div class="crans" role="group" aria-labelledby="intitule-rappel" aria-describedby="aide-rappel">${choixRappel}</div>
            <p class="reglage__aide" id="aide-rappel">${echapper(r.rappelAide)}</p>
          </div>
          <button type="button" class="bouton-danger" data-effacer>${echapper(r.effacer)}</button>
          <p class="confirmation" id="confirmation-reglages" role="status">${echapper(message)}</p>
        </div>
        ${versionInstallee ? html`<p class="reglages__version">${echapper(remplir(r.version, { version: versionInstallee }))}</p>` : ""}
      </section>
    `;
  }

  document.addEventListener("click", (evenement) => {
    const cran = evenement.target.closest("[data-taille]");
    if (cran) {
      const valeur = cran.dataset.taille;
      ecrire("taille", valeur);
      appliquerTaille(valeur);
      principal.querySelectorAll("[data-taille]").forEach((autre) => {
        autre.setAttribute("aria-pressed", autre.dataset.taille === valeur);
      });
      return;
    }

    const rappel = evenement.target.closest("[data-rappel]");
    if (rappel) {
      const valeur = rappel.dataset.rappel;
      if (valeur === "jamais") ecrire("rappel-sauvegarde", "jamais");
      else effacer("rappel-sauvegarde");
      principal.querySelectorAll("[data-rappel]").forEach((autre) => {
        autre.setAttribute("aria-pressed", autre.dataset.rappel === valeur);
      });
      return;
    }

    if (evenement.target.closest("[data-rappel-plus-tard]")) {
      const date = new Date();
      date.setDate(date.getDate() + RAPPEL_REPORT_JOURS);
      ecrire("rappel-reporte", jourISO(date));
      afficher();
      return;
    }

    const bouton = evenement.target.closest("[data-effacer]");
    if (bouton) {
      const r = ui.reglages;
      // Deux temps plutôt qu'une fenêtre de confirmation : effacer ce qu'on a écrit est
      // irréversible, un doigt qui glisse ne doit pas suffire.
      if (bouton.dataset.confirme !== "oui") {
        bouton.dataset.confirme = "oui";
        bouton.textContent = r.confirmer;
        return;
      }
      for (const cle of clesEnregistrees()) {
        if (!REGLAGES_GARDES.includes(cle)) effacer(cle);
      }
      messageReglages = r.efface;
      afficher();
    }
  });

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  Promise.all([
    chargerJson("interface.json"),
    chargerJson("index.json"),
    chargerJson("infos.json"),
    chargerJson("agenda.json"),
    chargerJson("pratique.json"),
  ])
    .then(([interfaceChargee, indexCharge, infosChargees, agendaCharge, pratiqueChargee]) => {
      ui = interfaceChargee;
      index = indexCharge;
      infos = infosChargees;
      agenda = agendaCharge;
      pratique = pratiqueChargee;
      construireOnglets();
      if (dejaInstallee()) compterOuverture();
      lireVersionInstallee();
      afficher();
      setTimeout(precharger, 1500);
      // Demander au navigateur de ne pas effacer les données de lui-même quand la place
      // manque. Ce n'est qu'une demande : ce qu'il en fait dépend de lui.
      if (dejaInstallee() && navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
    })
    .catch(() => {
      principal.innerHTML = html`<p class="message message--erreur">
        L’application n’a pas pu être chargée. Vérifie ta connexion et rouvre la page.
      </p>`;
    });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((erreur) => {
        console.warn("Service worker non enregistré :", erreur);
      });
    });
  }
})();
