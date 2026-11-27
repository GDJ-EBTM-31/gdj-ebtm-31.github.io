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

  // Un projet des responsables (#TousMigrants, septembre 2026) se remplit comme une étude —
  // des questions, le partage — mais se range sous Défis. C'est un sujet pour le code et le
  // stockage (`gdj:sujet:<id>:…`), un défi pour le jeune.
  function estProjet(sujet) {
    return Boolean(sujet && sujet.onglet === "defis");
  }

  // Mes notes (demandé par le responsable, septembre 2026) : une clé par note,
  // « note:<horodatage de création> », le texte tel quel. L'horodatage donne la date et
  // l'ordre ; une note vidée est effacée, il n'y a donc jamais de note blanche.
  function lireNotes() {
    return clesEnregistrees()
      .filter((cle) => /^note:\d+$/.test(cle))
      .map((cle) => ({ id: cle.slice("note:".length), texte: lire(cle) || "" }))
      .filter((note) => note.texte.trim())
      .sort((a, b) => Number(b.id) - Number(a.id));
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
      if (cle.startsWith("sujet:") || cle.startsWith("note:")) return Boolean((lire(cle) || "").trim());
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
  // Ce qu'écrit le coup de pinceau de l'affiche : « Aujourd'hui » le jour de la rencontre,
  // « Demain » la veille, « Dans 3 jours » avant, rien au-delà d'un mois. La veille et le
  // jour même, l'affiche ne disait rien : c'est pourtant là que le mot compte le plus
  // (vu le 12 novembre 2026 en faisant défiler les dates avec Sébastien).
  function delaiAvant(iso) {
    const jours = joursAvant(iso);
    if (jours === 0) return ui.agenda.aujourdhui;
    if (jours === 1) return ui.agenda.demain;
    if (jours < 0 || jours > 31) return "";
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
  // L'autocollant d'une nouveauté de « À la une » : une étoile à douze pointes, posée droite,
  // l'icône de l'onglet en blanc dedans (essai du 12 novembre 2026, voir docs/suivi.md).
  const ETOILE = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon
      points="12.00,0.00 14.38,3.11 18.00,1.61 18.51,5.49 22.39,6.00 20.89,9.62 24.00,12.00 20.89,14.38 22.39,18.00 18.51,18.51 18.00,22.39 14.38,20.89 12.00,24.00 9.62,20.89 6.00,22.39 5.49,18.51 1.61,18.00 3.11,14.38 0.00,12.00 3.11,9.62 1.61,6.00 5.49,5.49 6.00,1.61 9.62,3.11"
      fill="currentColor" /></svg>`;
  // Mes réflexions : une ampoule qui rayonne, celle de l'idée qui vient. Elle remplace
  // l'émoticône 🤔 reprise de la fiche Varak, seul élément en couleur d'une liste d'icônes au
  // trait. Dessin choisi par Sébastien sur captures le 12 novembre 2026, parmi trois ampoules
  // (à culot, à filament, qui rayonne), pendant la refonte « Affiche ». Le verre a été grossi
  // et le culot dessiné en deux traits le même jour : sans eux, « on ne comprend pas vraiment
  // que c'est une ampoule » (Sébastien).
  const AMPOULE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M9.9 15.4 C8.4 14.5 7.4 12.9 7.4 11.2 A4.6 4.6 0 0 1 16.6 11.2 C16.6 12.9 15.6 14.5 14.1 15.4 V17 H9.9 Z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path
      d="M10 19.3 H14 M10.9 21.6 H13.1 M12 2.4 V4 M3.4 11.2 H5 M19 11.2 H20.6 M5.9 5.1 L7 6.2 M18.1 5.1 L17 6.2"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>`;
  // Mes notes : un crayon.
  const CRAYON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M4 20 L4.8 16.2 L15.6 5.4 A2 2 0 0 1 18.4 5.4 L18.6 5.6 A2 2 0 0 1 18.6 8.4 L7.8 19.2 Z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M13.8 7.2 L16.8 10.2"
      stroke="currentColor" stroke-width="2" /></svg>`;
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
  // La note de musique de la playlist, dans Plus.
  const NOTE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path d="M9 17.5 V5.5 L19.5 3.5 V15.5" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><circle cx="6.5" cy="17.5"
      r="2.75" fill="currentColor" /><circle cx="17" cy="15.5" r="2.75" fill="currentColor" /></svg>`;
  // L'engrenage des réglages.
  const ENGRENAGE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
      focusable="false"><path fill="currentColor" fill-rule="evenodd"
      d="M9.26 1.76 L14.74 1.76 L14.12 4.08 L16.1 4.9 L17.3 2.82 L21.18 6.7 L19.1 7.9 L19.92 9.88 L22.24 9.26 L22.24 14.74 L19.92 14.12 L19.1 16.1 L21.18 17.3 L17.3 21.18 L16.1 19.1 L14.12 19.92 L14.74 22.24 L9.26 22.24 L9.88 19.92 L7.9 19.1 L6.7 21.18 L2.82 17.3 L4.9 16.1 L4.08 14.12 L1.76 14.74 L1.76 9.26 L4.08 9.88 L4.9 7.9 L2.82 6.7 L6.7 2.82 L7.9 4.9 L9.88 4.08 Z M8.5 12 A3.5 3.5 0 1 0 15.5 12 A3.5 3.5 0 1 0 8.5 12 Z" /></svg>`;
  // L'onglet Accueil : une maison, comme dans toute application. Elle remplace le logo GDJ en
  // petit rond (posé là le 11 septembre 2026) à la demande de Sébastien, le 12 novembre 2026,
  // pendant la refonte « Affiche ».
  const MAISON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
      focusable="false"><path d="M4 10.5 L12 4 L20 10.5 V19 A1.5 1.5 0 0 1 18.5 20.5 H5.5 A1.5 1.5 0 0 1 4 19 Z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M9.5 20.5 V14.5 H14.5 V20.5"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>`;
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
    if (tete === "note" && /^\d+$/.test(id || "")) return { ecran: "note", id };
    if (["sujets", "defis", "agenda", "plus", "notes", "pratique", "a-propos", "decouvrir", "sauvegarde", "reglages"].includes(tete)) return { ecran: tete };
    return { ecran: "accueil" };
  }

  function aller(destination) {
    const cible = "#/" + (destination || "");
    if (location.hash === cible) return afficher();
    location.hash = cible;
  }

  // Le changement d'écran n'est qu'un confort : le nouvel écran apparaît en fondu (classe
  // « entre », animée dans la feuille de style, et seulement si la personne n'a pas demandé
  // moins d'animations). Jusqu'en novembre 2026, c'était une transition du navigateur
  // (startViewTransition) sur toute la fenêtre : elle emportait la barre d'onglets avec la
  // page, ce qui dédoublait la bulle pendant qu'elle glisse d'un onglet à l'autre. Ici la
  // barre reste en place, et son verre continue de flouter ce qui passe dessous.
  function transition(changer) {
    changer();
    principal.classList.remove("entre");
    void principal.offsetWidth; // relance l'animation à chaque écran
    principal.classList.add("entre");
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

  function carte({ aller, classe = "", pastille, titre, sous = "", etiquette = "", autocollant = "" }) {
    return html`
      <li>
        <button type="button" class="fiche ${classe}" data-aller="${echapper(aller)}">
          ${pastille}
          <span class="fiche__texte">
            ${etiquette ? html`<span class="fiche__marque">${echapper(etiquette)}</span>` : ""}
            <span class="fiche__titre">${echapper(titre)}${autocollant}</span>
            ${sous ? html`<span class="fiche__sous">${echapper(sous)}</span>` : ""}
          </span>
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
    const mois = date.toLocaleDateString("fr-FR", { month: "short" });
    return html`<span class="date" aria-hidden="true">
      <span class="date__jour">${date.getDate()}</span>
      <span class="date__mois">${echapper(mois)}</span>
    </span>`;
  }

  // Une rencontre dans l'agenda. La date n'est dite qu'une fois à l'œil : le pavé, puis le
  // jour de la semaine en gris ; la date entière reste écrite pour les lecteurs d'écran, qui
  // ne lisent pas le pavé. Deux présentations, choisies par Sébastien sur captures le
  // 12 novembre 2026 (« La suite en lignes ») :
  // - « vedette » : la prochaine rencontre, en grand, l'autocollant au pinceau à côté de son
  //   nom (« Dans 3 jours », « Demain », « Aujourd'hui »), son message entier et le lien
  //   « Ajouter à mon calendrier » ;
  // - sinon, une ligne resserrée : « Ajouter » en pastille à droite (pour une rencontre à
  //   venir), le mot des responsables dessous, sur toute la largeur.
  function ligneEvenement(evenement, { vedette = false, calendrier = false } = {}) {
    const a = ui.agenda;
    const horaire = formaterHoraire(evenement);
    const jour = majuscule(dateLocale(evenement.date).toLocaleDateString("fr-FR", { weekday: "long" }));
    const quand = html`<p class="evenement__quand"><span aria-hidden="true">${echapper(jour)}</span><span class="lu">${echapper(
      formaterDate(evenement.date)
    )}</span>${horaire ? " · " + echapper(horaire) : ""}</p>`;
    const lieu = evenement.lieu ? html`<p class="evenement__lieu">${LIEU} ${echapper(evenement.lieu)}</p>` : "";
    const detail = evenement.detail ? html`<p class="evenement__detail">${echapper(evenement.detail)}</p>` : "";
    if (vedette) {
      const delai = delaiAvant(evenement.date);
      return html`
        <li class="evenement evenement--vedette">
          ${badgeDate(evenement.date)}
          <div class="evenement__texte">
            <p class="evenement__titre">${echapper(evenement.titre)}${delai
              ? `<span class="autocollant">${coupDePinceau(0)}${echapper(delai)}</span>`
              : ""}</p>
            ${quand}${lieu}${detail}
            <a class="evenement__calendrier" href="agenda/${echapper(evenement.id)}.ics">${CALENDRIER} ${echapper(a.ajouterCalendrier)}</a>
          </div>
        </li>
      `;
    }
    return html`
      <li class="evenement">
        ${badgeDate(evenement.date)}
        <div class="evenement__texte">
          <p class="evenement__titre">${echapper(evenement.titre)}</p>
          ${quand}${lieu}
        </div>
        ${calendrier
          ? html`<a class="evenement__ajouter" href="agenda/${echapper(evenement.id)}.ics"
              aria-label="${echapper(a.ajouterCalendrier + " : " + evenement.titre + ", " + formaterDate(evenement.date))}">${CALENDRIER} ${echapper(a.ajouter)}</a>`
          : ""}
        ${calendrier ? detail : ""}
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

  // La prochaine rencontre, en premier et en grand : c'est ce qu'on vient chercher le plus
  // souvent. Un toucher ouvre l'agenda.
  function blocRencontre() {
    const a = ui.accueil;
    const prochaine = evenementsAVenir()[0];
    if (!prochaine) return html`<p class="vide">${echapper(a.aucuneRencontre)}</p>`;
    const delai = delaiAvant(prochaine.date);
    // La date est écrite d'un trait, « Dimanche 15 novembre », comme on la dit. Elle a
    // d'abord eu un très grand chiffre : avec « dimanche » et « novembre » à sa droite,
    // Sébastien lisait « 15 dimanche novembre » ; « dimanche » au-dessus, puis le chiffre
    // décalé en escalier, ont été essayés le 12 novembre 2026, et l'affiche est devenue
    // « brouillon » (six éléments, cinq tailles, trois bords gauches). Quatre lignes au même
    // bord, à la place : le salut, « Prochaine rencontre dans 3 jours », la date, le thème.
    const jour = dateLocale(prochaine.date);
    const dateEcrite = majuscule(
      jour.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }).replace(/(^|\s)1(\s)/, "$11er$2")
    );
    const precisions = [prochaine.heure ? formaterHeure(prochaine.heure) : "", prochaine.lieu || ""].filter(Boolean).join(" · ");
    return html`<button type="button" class="rencontre" data-aller="agenda">
      <span class="rencontre__tete">
        <span class="rencontre__etiquette">${echapper(a.prochaineRencontre)}</span>
        ${delai ? html`<span class="rencontre__delai">${coupDePinceau(0)}${echapper(delai.charAt(0).toLowerCase() + delai.slice(1))}</span>` : ""}
      </span>
      <span class="rencontre__date">${echapper(dateEcrite)}</span>
      <span class="rencontre__pied">
        <span class="rencontre__titre">${echapper(prochaine.titre)}</span>
        <span class="rencontre__fleche">${CHEVRON_DROIT}</span>
      </span>
      ${precisions ? html`<span class="rencontre__lieu">${echapper(precisions)}</span>` : ""}
    </button>`;
  }

  // Un coup de pinceau derrière un mot : « Dans 3 jours » sur l'affiche, « À la une » dessous,
  // puis, en rose pâle, les titres des autres blocs de l'accueil (les deux tracés alternent).
  // Un pinceau brossé : des bandes de longueurs inégales, comme les poils, aux deux bouts,
  // qu'un filtre fait onduler. Deux tracés, pour qu'on voie deux gestes et non deux fois le
  // même. La couleur vient de la feuille de style (« currentColor »). Choisi par Sébastien
  // sur captures le 12 novembre 2026, à la place d'un aplat découpé façon marqueur. Le bout
  // droit a d'abord fini en fines traînées (« pinceau sec ») ; il les a trouvées étranges et
  // a demandé le même style qu'à gauche : ne pas les remettre. Là où le filtre n'existe pas,
  // il reste un rectangle aux bouts en escalier.
  const POILS = [
    [[14, 4, 166], [6, 11, 184], [1, 18, 196], [0, 25, 200], [2, 32, 195], [7, 39, 186], [16, 46, 164]],
    [[9, 4, 182], [3, 11, 193], [0, 18, 200], [4, 25, 190], [1, 32, 198], [11, 39, 174], [21, 46, 157]],
  ];
  let pinceaux = 0;

  function coupDePinceau(trace) {
    const id = "poils-" + ++pinceaux;
    const bandes = POILS[trace].map(([x, y, largeur]) => `<rect x="${x}" y="${y}" width="${largeur}" height="8.5" />`).join("");
    return `<svg class="pinceau" viewBox="0 0 200 58" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><filter
      id="${id}" x="-6%" y="-25%" width="112%" height="150%"><feTurbulence type="fractalNoise" baseFrequency="0.03 0.22"
      numOctaves="2" seed="${7 + trace * 14}" result="bruit" /><feDisplacementMap in="SourceGraphic" in2="bruit" scale="10"
      xChannelSelector="R" yChannelSelector="G" /></filter></defs><g fill="currentColor" filter="url(#${id})">${bandes}</g></svg>`;
  }

  // L'étude qui prépare une rencontre est celle qui porte sa date (champ « date » du sujet).
  // Elle ouvre « À la une », en « Étude à préparer », tant que cette rencontre est la
  // prochaine, que l'étude ait été ouverte ou non. Historique du 12 novembre 2026 : elle
  // figurait d'abord plus bas en « Nouvelle étude », sans lien avec la rencontre ; puis dans
  // l'affiche, en bouton blanc sous le titre, ce qui y mettait deux flèches l'une sous
  // l'autre (une vers l'agenda, une vers l'étude). Sébastien a préféré : l'affiche dit quand
  // on se retrouve, « À la une » dit ce qu'il y a à ouvrir. Ne pas la remettre dans l'affiche.
  function etudeDeLaRencontre(rencontre) {
    if (!rencontre) return null;
    return index.sujets.find((s) => !estProjet(s) && !sujetArchive(s.id) && s.date === rencontre.date) || null;
  }

  // Les raccourcis : ce qu'on vient chercher vite, écrit par les responsables dans
  // infos.json. Le feuillet de la cellule, par exemple.
  function blocRaccourcis() {
    const liste = infos.raccourcis || [];
    if (!liste.length) return "";
    // Des pastilles, le nom seul : la description du raccourci (infos.json) n'est plus
    // affichée, elle est lue par les lecteurs d'écran.
    const pastilles = liste
      .map((r) => {
        const precision = r.description ? ` aria-label="${echapper(r.titre + " : " + r.description)}"` : "";
        if (r.url) {
          return html`<li><a class="raccourci" href="${echapper(r.url)}" target="_blank" rel="noopener"${precision}>${echapper(r.titre)} ${EXTERIEUR}</a></li>`;
        }
        return html`<li><button type="button" class="raccourci" data-aller="${echapper(r.aller)}"${precision}>${echapper(r.titre)} ${CHEVRON_DROIT}</button></li>`;
      })
      .join("");
    return html`<h2 class="titre-pinceau">${coupDePinceau(1)}${echapper(ui.accueil.raccourcis)}</h2>
      <ul class="raccourcis">${pastilles}</ul>`;
  }

  // La bienvenue : elle explique l'application à qui vient de l'installer, et s'efface au
  // bouton « C'est parti » ou d'elle-même à la quatrième ouverture.
  function blocBienvenue() {
    if (!bienvenueAMontrer()) return "";
    const b = ui.bienvenue;
    // Deux phrases et rien d'autre : Sébastien trouvait la carte « brouillon », avec
    // « Bienvenue » en étiquette puis en titre et une liste de quatre points (12 novembre
    // 2026). L'étiquette ne s'affiche plus, elle nomme le bloc pour les lecteurs d'écran ;
    // « points » reste accepté, en liste vide : le code en ligne le parcourt encore.
    const points = b.points || [];
    return html`
      <section class="une" aria-label="${echapper(b.etiquette)}">
        <h1 class="une__titre">${echapper(b.titre)}</h1>
        <p class="une__texte">${echapper(b.texte)}</p>
        ${points.length ? html`<ul class="une__liste">${points.map((point) => html`<li>${echapper(point)}</li>`).join("")}</ul>` : ""}
        ${b.fin ? html`<p class="une__texte une__texte--fin">${echapper(b.fin)}</p>` : ""}
        <button type="button" class="une__action" data-bienvenue>${echapper(b.bouton)} ${COCHE}</button>
      </section>
    `;
  }

  // « À la une » : la rubrique de ce qui vient de sortir. Le mot des responsables quand ils
  // en écrivent un (infos.json, « aLaUne »), puis les nouveautés (voir « estALaUne ») : les
  // études et les défis sortis depuis la dernière rencontre. Une nouveauté quitte la rubrique
  // le lendemain de la rencontre qui suit sa sortie ; la rubrique disparaît quand elle est
  // vide. Demandé par Sébastien le 12 novembre 2026 : « à la une, c'est quand ça vient de
  // sortir, et après ça disparaît ». Avant, « À la une » était un texte fixe.
  function blocALaUne() {
    const a = ui.accueil;
    const u = infos.aLaUne || {};
    const mot = u.titre || u.texte
      ? html`<div class="a-la-une__mot">
          ${u.titre ? html`<h3 class="une__titre">${echapper(u.titre)}</h3>` : ""}
          ${u.texte ? html`<p class="une__texte">${echapper(u.texte)}</p>` : ""}
        </div>`
      : "";
    const lignes = nouveautes().map(ligneNouveaute).join("");
    if (!mot && !lignes) return "";
    return html`
      <section class="a-la-une" aria-labelledby="titre-a-la-une">
        <h2 class="a-la-une__titre" id="titre-a-la-une">${coupDePinceau(1)}${echapper(a.aLaUne)}</h2>
        ${mot}${lignes}
      </section>
    `;
  }

  // « Salut Léa, » en haut de l'accueil, quand le jeune a donné son prénom (dans les
  // réglages ou au moment de partager). Sans prénom, rien. « Salut », qui va avec le
  // tutoiement, a remplacé « Bonjour » et « Bonsoir » à partir de 18 h (Sébastien,
  // 12 novembre 2026) : le même mot à toute heure. Les textes « bonjour » et « bonsoir »
  // restent dans interface.json tant que le code en ligne, qui les lit, n'est pas remplacé.
  function blocBonjour() {
    const prenom = (lire("prenom") || "").trim();
    if (!prenom) return "";
    const modele = ui.accueil.salut;
    // Un prénom de plus de douze lettres ne tient plus sur une ligne en grand titre : il est
    // écrit un cran plus petit, pour que le salut ne prenne pas toute l'affiche.
    const classe = prenom.length > 12 ? "bonjour bonjour--long" : "bonjour";
    return html`<p class="${classe}">${echapper(remplir(modele, { prenom }))}</p>`;
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

  // Les formations de l'église ouvertes aux jeunes, qui vont commencer. Elles demandent une
  // inscription : un jeune ne doit pas croire qu'il suffit de venir le jour même. Chacune est
  // une ligne d'« À venir », rangée par date avec les annonces, avec un vrai bouton
  // « M'inscrire » et la mention « Inscription obligatoire » — une simple mention, sans
  // panneau d'avertissement, à la demande de Sébastien. Elle disparaît le lendemain de sa
  // première séance (ou de « jusquAu », s'il est donné) : sur l'accueil, il n'y a que ce qui
  // va arriver. Jusqu'au 12 novembre 2026, elle avait son bloc à elle (« Formation à
  // venir »), avec son texte de présentation et un bouton pleine largeur : presque un écran
  // à lui seul, que Sébastien a trouvé « très surchargé ». Le texte de présentation
  // (« texte ») ne s'affiche plus que si les jours (« quand ») ne sont pas donnés.

  function finInscription(formation) {
    return formation.jusquAu || [...(formation.dates || [])].sort()[0] || "";
  }

  function ligneFormation(formation, date) {
    const a = ui.accueil;
    const detail = formation.quand || formation.texte || "";
    return html`<li><div class="a-venir__ligne a-venir__ligne--formation">
      ${date ? badgeDate(date) : pastille(INFO)}
      <span class="a-venir__texte">
        <span class="a-venir__titre">${echapper(formation.titre)}</span>
        ${detail ? html`<span class="a-venir__detail">${echapper(detail)}</span>` : ""}
        <span class="inscription">
          <a class="inscription__bouton" href="${echapper(formation.url)}" target="_blank" rel="noopener"
            aria-label="${echapper(remplir(a.inscrireA, { titre: formation.titre }))}">${echapper(a.inscrire)} ${EXTERIEUR}</a>
          <span class="inscription__mention">${echapper(a.inscriptionObligatoire)}</span>
        </span>
      </span>
    </div></li>`;
  }

  // « À venir » : les annonces et les formations en cours, dans une seule liste rangée par
  // date, la plus proche en premier. Ce qui n'a pas de date vient à la fin, dans l'ordre du
  // fichier.
  function blocAnnonces() {
    const a = ui.accueil;
    const aujourdhui = aujourdhuiISO();
    const prochaine = (element) => [...(element.dates || [])].sort().find((d) => d >= aujourdhui) || "";
    const lignes = [];
    for (const annonce of infos.annonces || []) {
      const fin = dernierJour(annonce);
      if (!fin || fin >= aujourdhui) lignes.push({ date: prochaine(annonce), ligne: ligneAnnonce(annonce, aujourdhui) });
    }
    for (const formation of infos.formations || []) {
      const fin = finInscription(formation);
      if (!fin || fin >= aujourdhui) lignes.push({ date: prochaine(formation), ligne: ligneFormation(formation, prochaine(formation)) });
    }
    if (!lignes.length) return "";
    // Le tri est stable : à date égale, et pour ce qui n'a pas de date, l'ordre d'arrivée.
    lignes.sort((x, y) => (x.date || "9999").localeCompare(y.date || "9999"));
    return html`
      <section class="a-venir" aria-labelledby="titre-a-venir">
        <h2 class="titre-pinceau" id="titre-a-venir">${coupDePinceau(0)}${echapper(a.aVenir)}</h2>
        <ul class="a-venir__liste">${lignes.map((l) => l.ligne).join("")}</ul>
      </section>
    `;
  }

  // Une affiche de l'église (infos.json, « affiches »), juste après « À venir » : l'image
  // entourée d'un bord blanc ; si elle a un « fond », cette photo en carte postale derrière
  // elle (le concert Kumbaya sur une photo du Capitole prise par Sébastien, choisi le
  // 27 novembre 2026 après des essais au scotch, aux punaises et en panorama). Le texte de
  // l'affiche n'est pas lu par les lecteurs d'écran : sa « description » le dit à sa place.
  // La photo du fond est un décor : texte de remplacement vide, les lecteurs d'écran la sautent.
  // Elle s'efface le lendemain de son « jusquAu ». Toucher l'affiche ne fait rien : ouvrir
  // l'image seule, dans l'application installée sur iPhone, en sortirait sans retour
  // possible. Demandé par Sébastien le 27 novembre 2026, pour le concert Kumbaya.
  function blocAffiches() {
    const aujourdhui = aujourdhuiISO();
    const enCours = (infos.affiches || []).filter((affiche) => affiche.image && affiche.jusquAu >= aujourdhui);
    if (!enCours.length) return "";
    return html`
      <section class="affiches" aria-label="${echapper(ui.accueil.affiche || "Affiche")}">
        ${enCours
          .map((affiche) => {
            const figure = html`<figure class="affiche-collee">
              <img src="${echapper(affiche.image)}" alt="${echapper(affiche.description || "")}" decoding="async" />
            </figure>`;
            if (!affiche.fond) return figure;
            return html`<div class="affiche-mur">
              <img class="affiche-mur__fond" src="${echapper(affiche.fond)}" alt="" decoding="async" />
              ${figure}
            </div>`;
          })
          .join("")}
      </section>
    `;
  }

  // Une information des responsables (infos.json, « informations ») : pas un rendez-vous,
  // donc pas dans « À venir ». Une carte blanche sans titre, après la nouvelle étude, chaque
  // ligne faite comme une annonce et effacée le lendemain de son « jusquAu ». Placée là par
  // Sébastien le 22 octobre 2026, pour la playlist du groupe.
  function blocInformations() {
    const aujourdhui = aujourdhuiISO();
    const enCours = (infos.informations || []).filter((info) => {
      const fin = dernierJour(info);
      return !fin || fin >= aujourdhui;
    });
    if (!enCours.length) return "";
    return html`
      <section class="a-venir a-venir--information" aria-label="${echapper(ui.accueil.information)}">
        <ul class="a-venir__liste">${enCours.map((info) => ligneAnnonce(info, aujourdhui)).join("")}</ul>
      </section>
    `;
  }

  // Une étude que le jeune n'a pas encore ouverte : un bloc blanc sous l'affiche (ce qu'elle
  // est en magenta, son titre en lettres épaisses, « 3 questions à découvrir », la flèche),
  // tout entier à toucher. Refonte « Affiche », novembre 2026 ; avant, une carte au pavé en
  // dégradé, choisie le 12 novembre à la place d'un bouton « Découvrir » (« ça fait brouillon »).
  // Un sujet qui porte « jusquAu » garde sa carte jusqu'à ce jour inclus, ouvert ou non, et
  // la perd le lendemain à minuit : le projet #TousMigrants reste annoncé jusqu'au jour de la
  // rencontre (demandé par Sébastien le 25 septembre 2026).
  // Jusqu'à quand une étude ou un défi compte comme une nouveauté : jusqu'à la rencontre qui
  // suit sa sortie, ce jour-là compris. Une étude datée du jour d'une rencontre est donc
  // nouvelle jusqu'à cette rencontre ; un défi sorti trois jours avant, jusqu'à elle aussi.
  // Ensuite il n'est plus « à la une » ni marqué « Nouveau », ouvert ou non : il reste dans
  // son onglet. Sébastien, le 12 novembre 2026 : se régler sur les dates de l'agenda, et ne
  // pas charger l'accueil de défis « devenus obsolètes ». Un « jusquAu » écrit par les
  // responsables l'emporte ; sans rencontre après la sortie, quatorze jours.
  function finDeNouveaute(sujet) {
    if (sujet.jusquAu) return sujet.jusquAu;
    const suivante = (agenda.evenements || []).map((e) => e.date).sort().find((date) => date >= sujet.date);
    if (suivante) return suivante;
    const fin = dateLocale(sujet.date);
    fin.setDate(fin.getDate() + 14);
    return jourISO(fin);
  }

  // « À la une » aujourd'hui ? Tant que la rencontre qui suit sa sortie n'est pas passée, que
  // le jeune l'ait ouvert ou non : un défi ne cesse pas d'être d'actualité parce qu'on l'a
  // regardé une fois (Sébastien, le 12 novembre 2026, en ne retrouvant plus sur l'accueil le
  // défi qu'il venait d'ouvrir).
  function estALaUne(sujet) {
    return finDeNouveaute(sujet) >= aujourdhuiISO();
  }

  // L'étiquette « Nouveau » d'une liste, elle, dit « pas encore ouvert » : elle part à la
  // première ouverture, ou avec la fin de la nouveauté.
  function estNouveau(sujet) {
    return estALaUne(sujet) && !lire("vu:sujet:" + sujet.id);
  }

  // Les lignes d'« À la une » : l'étude à préparer pour la prochaine rencontre toujours en
  // premier, puis les nouveautés, la plus proche dans le temps d'abord (celle dont la
  // rencontre arrive le plus tôt, et à échéance égale la plus récemment sortie). Trois au
  // plus, pour que l'accueil reste court.
  function nouveautes() {
    const aPreparer = etudeDeLaRencontre(evenementsAVenir()[0]);
    const autres = index.sujets
      .filter((s) => s !== aPreparer && !sujetArchive(s.id) && estALaUne(s))
      .sort((a, b) => finDeNouveaute(a).localeCompare(finDeNouveaute(b)) || b.date.localeCompare(a.date));
    return (aPreparer ? [aPreparer, ...autres] : autres).slice(0, 3);
  }

  // Une ligne d'« À la une » : ce que c'est (et le nombre de questions), son nom, et la flèche
  // dans un rond presque noir, qui répond au rond blanc de l'affiche. Rien de plus :
  // Sébastien trouvait la ligne « trop surchargée » avec « À découvrir » et un résumé
  // (12 novembre 2026).
  function ligneNouveaute(nouveau) {
    const a = ui.accueil;
    const combien = nouveau.questions === 1 ? a.uneQuestion : nouveau.questions > 1 ? remplir(a.desQuestions, { nombre: nouveau.questions }) : "";
    // « Nouveau défi », « Nouvelle étude » tant que le jeune ne l'a pas ouvert ; ensuite
    // « Défi », « Étude » : la ligne reste jusqu'à la rencontre, mais ne se dit plus nouvelle.
    // « Défi » seul ne disait pas assez que c'était nouveau (Sébastien, 12 novembre 2026).
    // L'étude de la prochaine rencontre, elle, se dit « Étude à préparer » jusqu'au bout.
    const pasOuvert = !lire("vu:sujet:" + nouveau.id);
    const aPreparer = nouveau === etudeDeLaRencontre(evenementsAVenir()[0]);
    const nom = estProjet(nouveau)
      ? (pasOuvert ? ui.defi.nouveauDefi : ui.defi.defi)
      : aPreparer ? a.aPreparer : pasOuvert ? a.nouveauSujet : a.etude;
    // Espaces insécables : sur un petit écran, la ligne se coupe après le point médian, jamais
    // entre « 3 » et « questions ».
    const genre = [nom, combien].filter(Boolean).join("\u00a0· ");
    // Une étoile devant le mot, posée droite pour ne pas s'ajouter aux deux coups de pinceau
    // penchés, avec l'icône de l'onglet dedans (le livre, le drapeau). Elle reste tant que la
    // ligne est « à la une », ouverte ou non : c'est le mot qui dit « Nouveau ». Elle partait
    // d'abord à l'ouverture, et Sébastien a vu l'étude perdre son étoile à côté d'un défi qui
    // gardait la sienne : « ça gardait la cohérence » (12 novembre 2026). Décor seulement.
    const etoile = `<span class="nouveau__etoile" aria-hidden="true">${ETOILE}${estProjet(nouveau) ? DRAPEAU : LIVRE}</span>`;
    return html`<button type="button" class="nouveau" data-aller="sujet/${echapper(nouveau.id)}">
      <span class="nouveau__texte">
        <span class="nouveau__etiquette nouveau__etiquette--etoile">${etoile}${echapper(genre)}</span>
        <span class="nouveau__titre">${echapper(nouveau.titre)}</span>
      </span>
      <span class="nouveau__fleche">${CHEVRON_DROIT}</span>
    </button>`;
  }

  // Les cartes des sujets et des défis servent à l'accueil (un aperçu) et à leur onglet
  // (la liste entière).
  // Une étude dans la liste de l'onglet. « aFaire » : celle dont la rencontre n'a pas encore
  // eu lieu porte, à côté de son nom, un petit autocollant au pinceau (« À préparer », le mot
  // de l'accueil ; « À faire » sonnait comme un devoir, Sébastien, 12 novembre 2026), jusqu'au
  // jour de la rencontre, qu'elle ait été ouverte ou non. C'est le seul signe de la liste :
  // l'étiquette « Nouvelle », une étoile, un pavé de date, des fonds et une carte ont été
  // essayés et écartés par Sébastien le 12 novembre 2026 (« trop surchargé », « too much »).
  function carteSujet(s, archive, aFaire = false) {
    return carte({
      aller: "sujet/" + s.id,
      classe: archive ? "fiche--sujet fiche--archive" : "fiche--sujet",
      pastille: pastille(BULLE, archive ? "" : "fiche__pastille--vive"),
      titre: s.titre,
      sous: [s.sousTitre, s.questions ? s.questions + " questions" : ""].filter(Boolean).join(" · "),
      autocollant: aFaire ? `<span class="autocollant">${coupDePinceau(0)}${echapper(ui.sujets.aFaire)}</span>` : "",
    });
  }

  // Un projet des responsables dans la liste de l'onglet Défis : rien à cocher, donc pas
  // d'anneau. « enCours » : tant que la rencontre qui suit sa sortie n'est pas passée, il
  // porte à côté de son nom le même autocollant au pinceau que l'étude à préparer, ouvert ou
  // non. Même liste, même signe, même rangement que les Études (demandé par Sébastien le
  // 12 novembre 2026) ; l'étiquette « Nouveau » ne s'affiche plus ici.
  function carteProjet(s, enCours = false) {
    return carte({
      aller: "sujet/" + s.id,
      classe: "fiche--sujet",
      pastille: pastille(DRAPEAU, "fiche__pastille--vive"),
      titre: s.titre,
      sous: s.questions ? s.questions + " questions" : s.resume,
      autocollant: enCours ? `<span class="autocollant">${coupDePinceau(0)}${echapper(ui.defis.enCours)}</span>` : "",
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

  // Refonte « Affiche » (choisie par Sébastien sur maquettes le 12 novembre 2026) : tout en
  // haut, l'affiche — « Bonjour » et la prochaine rencontre en très grand, sur l'aplat de
  // couleur. Le mot des responsables (« À la une ») vient juste dessous, en bloc blanc : la
  // prochaine rencontre passe donc avant lui et prend la couleur, à l'inverse de l'ordre de
  // septembre. Ensuite : la bienvenue des premières ouvertures, la rubrique « À la une » (le
  // mot des responsables et les nouveautés), « À venir », la formation, l'information, le
  // rappel de sauvegarde, les raccourcis. Pas de logo : l'icône sur
  // l'écran d'accueil du téléphone suffit.
  function ecranAccueil() {
    return html`
      <section class="affiche">
        ${blocBonjour()}
        ${blocRencontre()}
      </section>
      ${blocBienvenue()}
      ${blocALaUne()}
      ${enBandes([
        [blocAnnonces()],
        [blocAffiches()],
        [blocInformations(), "bande--mince"],
        [blocRappel()],
        [blocRaccourcis()],
      ])}
      ${boutonMesNotes()}
    `;
  }

  // Sous « À la une », chaque bloc présent a sa bande, d'un bord à l'autre de l'écran : la
  // première rose très pâle, la suivante blanche, et ainsi de suite. Quand tous les blocs
  // étaient là, seuls des filets gris les séparaient et « on s'y perdait » (Sébastien,
  // 12 novembre 2026, qui a choisi « Bandes roses » sur captures, face à des cartes).
  // L'alternance se fait sur les blocs réellement affichés : deux voisins n'ont jamais le
  // même fond, quels que soient ceux que les responsables ont remplis.
  function enBandes(blocs) {
    return blocs
      .filter(([contenu]) => contenu.trim())
      .map(([contenu, classe], rang) => `<div class="bande${rang % 2 ? "" : " bande--rose"}${classe ? " " + classe : ""}">${contenu}</div>`)
      .join("");
  }

  // Le bouton flottant de l'accueil, au-dessus de la barre d'onglets : il mène à Mes notes.
  // Choisi par Sébastien le 25 septembre 2026 plutôt qu'un encart, pour garder l'accueil
  // épuré ; sur l'accueil seulement, ailleurs il cacherait le bas des écrans. Le crayon seul,
  // sans le mot : c'est l'exception à la règle « jamais d'icône seule », voulue par Sébastien
  // le même jour après avoir vu les versions avec « Mes notes » et « Notes ». Le nom reste lu
  // par les lecteurs d'écran, et Mes notes reste dans Plus avec son nom écrit.
  function boutonMesNotes() {
    return html`<button type="button" class="bouton-flottant" data-aller="notes" aria-label="${echapper(ui.notes.bouton)}">${CRAYON}</button>`;
  }

  // ---------------------------------------------------------------------------
  // Les onglets Sujets, Défis et Plus
  // ---------------------------------------------------------------------------

  // « Études précédentes », « Défis précédents » : une liste qu'on replie ou qu'on rouvre en
  // touchant son titre, pour ne pas l'avoir sous les yeux si l'on n'en veut pas (demandé par
  // Sébastien le 12 novembre 2026). Repliée tant qu'on n'y a pas touché, pour un écran court
  // dès la première ouverture (son choix) ; le téléphone retient ensuite le dernier état
  // (clé « deplie:<nom> », écrite par l'écouteur « toggle »).
  function blocRepliable(nom, titre, cartes) {
    return html`<details class="precedentes" data-deplie="${nom}"${lire("deplie:" + nom) ? " open" : ""}>
      <summary class="liste-titre precedentes__titre">${echapper(titre)}</summary>
      <ul class="fiches">${cartes}</ul>
    </details>`;
  }

  function ecranSujets() {
    const a = ui.accueil;
    const etudes = index.sujets.filter((s) => !estProjet(s));
    const actifs = etudes.filter((s) => !sujetArchive(s.id));
    const archives = etudes.filter((s) => sujetArchive(s.id));
    // Deux parties : les études à faire (leur rencontre n'a pas encore eu lieu, la plus
    // proche en premier), puis les précédentes sous un petit titre, dans l'ordre de la
    // liste. Une étude passe de l'une à l'autre le lendemain de sa rencontre. Sans étude à
    // faire, ou sans étude précédente, il n'y a qu'une liste, sans titre.
    const aujourdhui = aujourdhuiISO();
    const aFaire = actifs.filter((s) => s.date >= aujourdhui).sort((x, y) => x.date.localeCompare(y.date));
    const precedentes = actifs.filter((s) => !(s.date >= aujourdhui));
    const separees = aFaire.length && precedentes.length;
    const sujets = actifs.length
      ? aFaire.map((s) => carteSujet(s, false, true)).join("") + (separees ? "" : precedentes.map((s) => carteSujet(s, false)).join(""))
      : html`<li><p class="vide">${echapper(a.aucunSujet)}</p></li>`;
    const blocPrecedentes = separees
      ? blocRepliable("sujets", ui.sujets.precedentes, precedentes.map((s) => carteSujet(s, false)).join(""))
      : "";
    const blocArchives = archives.length
      ? html`<details class="archives">
          <summary class="section-titre archives__titre">${echapper(a.archives)} (${archives.length})</summary>
          <ul class="fiches">${archives.map((s) => carteSujet(s, true)).join("")}</ul>
        </details>`
      : "";
    return html`
      <section class="page">
        <header class="page__entete"><h1 class="page__titre">${echapper(ui.sujets.titre)}</h1></header>
        <ul class="fiches${separees ? " fiches--a-faire" : ""}">${sujets}</ul>
        ${blocPrecedentes}
        ${blocArchives}
      </section>
    `;
  }

  function ecranDefis() {
    // Deux parties, comme les Études. D'abord ce qui est d'actualité : les projets en cours
    // (voir « estALaUne » : jusqu'à la rencontre qui suit leur sortie), avec l'autocollant,
    // et les défis à cocher, qui n'ont pas de date et gardent leur anneau. Puis, sous un
    // petit titre, les projets précédents. Dans chaque partie, l'ordre voulu par les
    // responsables (« ordre »). Sans l'une des deux parties, une seule liste, sans titre.
    const parOrdre = (a, b) => a.ordre - b.ordre || a.titre.localeCompare(b.titre, "fr");
    const projets = index.sujets.filter(estProjet);
    const actuels = [
      ...projets.filter(estALaUne).map((s) => ({ ordre: s.ordre ?? 999, titre: s.titre, carte: () => carteProjet(s, true) })),
      ...index.defis.map((d) => ({ ordre: d.ordre ?? 999, titre: d.titre, carte: () => carteDefi(d) })),
    ].sort(parOrdre);
    const precedents = projets
      .filter((s) => !estALaUne(s))
      .map((s) => ({ ordre: s.ordre ?? 999, titre: s.titre, carte: () => carteProjet(s) }))
      .sort(parOrdre);
    const separes = actuels.length && precedents.length;
    const tous = separes ? actuels : [...actuels, ...precedents];
    const defis = tous.length
      ? tous.map((element) => element.carte()).join("")
      : html`<li><p class="vide">${echapper(ui.accueil.aucunDefi)}</p></li>`;
    const blocPrecedents = separes
      ? blocRepliable("defis", ui.defis.precedents, precedents.map((element) => element.carte()).join(""))
      : "";
    return html`
      <section class="page">
        <header class="page__entete"><h1 class="page__titre">${echapper(ui.defis.titre)}</h1></header>
        <ul class="fiches${separes ? " fiches--a-faire" : ""}">${defis}</ul>
        ${blocPrecedents}
      </section>
    `;
  }

  // Trois groupes, dans l'ordre d'avant : ce qui est à soi (Mes notes), ce qui vient du groupe
  // (Pratique, la playlist, Partage l'appli), puis l'application elle-même (Sauvegarder, À
  // propos, Réglages).
  // La playlist des responsables (infos.json) s'ouvre sur YouTube : ils la mettent à jour
  // de leur côté, sans republier l'application. Demandée par le responsable le 22 octobre 2026.
  function ecranPlus() {
    const a = ui.accueil;
    const playlist = infos.playlist;
    return html`
      <section class="page">
        <header class="page__entete"><h1 class="page__titre">${echapper(ui.plus.titre)}</h1></header>
        <ul class="fiches">
          ${carte({ aller: "notes", classe: "fiche--notes-perso", pastille: pastille(CRAYON), titre: ui.notes.titre })}
        </ul>
        <ul class="fiches fiches--groupe">
          ${carte({ aller: "pratique", classe: "fiche--pratique", pastille: pastille(BOUSSOLE), titre: ui.pratique.titre })}
          ${playlist && playlist.url ? lienExterne(playlist, NOTE) : ""}
          ${carte({ aller: "decouvrir", classe: "fiche--ami", pastille: pastille(QR), titre: ui.plus.partager, sous: ui.plus.partagerSous })}
        </ul>
        <ul class="fiches fiches--groupe">
          ${carte({ aller: "sauvegarde", classe: "fiche--sauvegarde", pastille: pastille(SAUVEGARDE), titre: a.sauvegarde })}
          ${carte({ aller: "a-propos", classe: "fiche--a-propos", pastille: pastille(INFO), titre: a.aProposApp })}
          ${carte({ aller: "reglages", classe: "fiche--reglages", pastille: pastille(ENGRENAGE), titre: ui.plus.reglages })}
        </ul>
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // La neige des fêtes
  // ---------------------------------------------------------------------------
  //
  // Demandée par Sébastien le 27 novembre 2026 : pendant les fêtes, des flocons tombent sur
  // l'application et la neige s'amasse sur le haut de la barre d'onglets et du bouton des
  // notes. La période est dans infos.json (« neige » : « du », « au ») : la neige part
  // d'elle-même, sans republier.
  //
  // Tout est dessiné sur une toile posée par-dessus l'écran, qui laisse passer les touchers
  // et que les lecteurs d'écran ignorent. Les flocons tombent sur les écrans qui ont la barre
  // d'onglets, pas sur ceux où l'on écrit.
  //
  // La neige s'amasse vraiment (idée reprise de l'option « collection » du module jQuery
  // Snowfall) : le haut de la barre et du bouton est découpé en colonnes de quelques points ;
  // un flocon qui s'y pose ajoute un peu de neige à l'endroit exact où il tombe. Quand une
  // colonne dépasse trop sa voisine, la neige glisse vers elle, comme du sable : c'est ce qui
  // fait les vagues, et ce qui fait couler la neige le long des arrondis. Aux deux bouts, elle
  // dépasse un peu en corniche ; au-delà, une motte se détache et tombe. Toucher un onglet ou
  // le bouton fait tomber la neige qui est dessus ; elle se reforme si l'on reste.
  //
  // Avec « réduire les animations », rien ne tombe ni ne bouge : les tas dessinés en CSS
  // (classe « neige » sans « neige-vivante ») restent, immobiles. La toile commence sous la
  // zone de l'heure : sur iPhone, un bloc fixé qui touche le haut de l'écran change la couleur
  // de cette zone (voir docs/suivi.md, « Pièges rencontrés »). Batterie : une quarantaine de
  // flocons, trente images par seconde, et tout s'arrête quand l'application passe en
  // arrière-plan.

  const NEIGE = {
    nombre: 40, // flocons pour 390 points de large
    vitesse: 42, // points par seconde, pour un flocon moyen
    colonne: 3, // largeur d'une colonne de neige, en points
    pente: 0.75, // écart de hauteur toléré entre deux colonnes voisines, en points
    depot: 15, // neige qu'apporte un flocon qui se pose (colonnes × points)
  };
  const mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)");
  const neige = {
    toile: null,
    dessin: null,
    flocon: null,
    flocons: [],
    mottes: [],
    surfaces: new Map(),
    voulue: false,
    boucle: 0,
    image: 0,
    mesure: 0,
  };

  function neigeDeSaison() {
    const periode = infos && infos.neige;
    if (!periode || !periode.du || !periode.au) return false;
    const jour = aujourdhuiISO();
    return jour >= periode.du && jour <= periode.au;
  }

  function reglerNeige(ecran, sansOnglets) {
    const saison = neigeDeSaison() && ecran !== "installation";
    const vivante = saison && !mouvementReduit.matches && preparerToile();
    document.body.classList.toggle("neige", saison);
    document.body.classList.toggle("neige-vivante", vivante);
    neige.voulue = vivante && !sansOnglets;
    neige.mesure = 0; // l'écran change : on remesure la barre et le bouton à l'image suivante
    if (neige.voulue && !document.hidden) demarrerNeige();
    else arreterNeige();
  }

  // Un flocon dessiné une fois pour toutes, puis recopié à chaque image (bien moins coûteux
  // que de le redessiner) : un cœur blanc et un halo lavande qui s'efface. Le halo le rend
  // visible sur le fond blanc de l'application ; un contour net faisait des bulles.
  function dessinerFlocon() {
    const modele = document.createElement("canvas");
    modele.width = modele.height = 32;
    const d = modele.getContext("2d");
    const degrade = d.createRadialGradient(16, 16, 0, 16, 16, 16);
    degrade.addColorStop(0, "rgba(255, 255, 255, 1)");
    degrade.addColorStop(0.38, "rgba(255, 255, 255, 0.98)");
    degrade.addColorStop(0.55, "rgba(214, 190, 226, 0.55)");
    degrade.addColorStop(1, "rgba(152, 40, 152, 0)");
    d.fillStyle = degrade;
    d.fillRect(0, 0, 32, 32);
    return modele;
  }

  // La toile n'est créée qu'une fois ; si le navigateur ne sait pas dessiner, on reste aux
  // tas immobiles du CSS.
  function preparerToile() {
    if (neige.dessin) return true;
    if (neige.toile) return false;
    const toile = document.createElement("canvas");
    toile.className = "neige-toile";
    toile.setAttribute("aria-hidden", "true");
    toile.hidden = true;
    document.body.appendChild(toile);
    neige.toile = toile;
    neige.dessin = toile.getContext("2d");
    if (!neige.dessin) return false;
    neige.flocon = dessinerFlocon();
    // La toile se redimensionne dès que sa taille change, quelle qu'en soit la raison. Dans
    // l'application installée sur iPhone, l'écran finit de se mettre en place juste après
    // l'ouverture (zone de l'heure, hauteur disponible) sans que la fenêtre annonce de
    // changement de taille : la toile gardait sa première mesure, et les tas de neige se
    // dessinaient une cinquantaine de points trop haut jusqu'au premier toucher (vu par
    // Sébastien sur son iPhone, 27 novembre 2026, version 2.1.1).
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => {
        if (neige.voulue && !toile.hidden) dimensionnerNeige();
      }).observe(toile);
    }
    window.addEventListener("resize", () => {
      if (neige.voulue) dimensionnerNeige();
    });
    return true;
  }

  function nouveauFlocon(largeur, hauteur, auHasard) {
    const rayon = 1.2 + Math.random() * 2.2;
    return {
      x: Math.random() * largeur,
      y: auHasard ? Math.random() * hauteur : -rayon * 2,
      rayon,
      // Les gros flocons, plus proches, tombent un peu plus vite.
      vitesse: NEIGE.vitesse * (0.55 + (rayon / 3.4) * 0.6),
      phase: Math.random() * Math.PI * 2,
      ampleur: 6 + Math.random() * 14,
    };
  }

  function dimensionnerNeige() {
    const toile = neige.toile;
    const echelle = Math.min(window.devicePixelRatio || 1, 2);
    toile.width = Math.round(toile.clientWidth * echelle);
    toile.height = Math.round(toile.clientHeight * echelle);
    neige.dessin.setTransform(echelle, 0, 0, echelle, 0, 0);
    const voulu = Math.round(NEIGE.nombre * (toile.clientWidth / 390));
    while (neige.flocons.length < voulu) neige.flocons.push(nouveauFlocon(toile.clientWidth, toile.clientHeight, true));
    neige.flocons.length = voulu;
    neige.mesure = 0;
  }

  // Les surfaces où la neige se pose, dans le repère de la toile. « base[i] » est le haut de
  // l'objet sous la colonne i (il suit l'arrondi des bouts de la barre et du rond), « h[i] »
  // l'épaisseur de neige posée dessus.
  function mesurerSurfaces() {
    const decalage = neige.toile.getBoundingClientRect().top;
    const vues = new Set();
    const barre = document.getElementById("onglets");
    if (barre && !barre.hidden) {
      const r = barre.getBoundingClientRect();
      const rayon = Math.min(36, r.height / 2);
      ajusterSurface("barre", r.left + 6, r.right - 6, 13, (x) => {
        const bord = Math.min(x - r.left, r.right - x);
        const creux = bord < rayon ? rayon - Math.sqrt(Math.max(0, rayon * rayon - (rayon - bord) ** 2)) : 0;
        return r.top - decalage + creux;
      });
      vues.add("barre");
    }
    const bouton = document.querySelector(".bouton-flottant");
    if (bouton) {
      const r = bouton.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2 - decalage;
      const rayon = r.width / 2;
      ajusterSurface("rond", cx - rayon * 0.86, cx + rayon * 0.86, 10, (x) => cy - Math.sqrt(Math.max(0, rayon * rayon - (x - cx) ** 2)));
      vues.add("rond");
    }
    for (const [cle, surface] of neige.surfaces) surface.visible = vues.has(cle);
  }

  function ajusterSurface(cle, gauche, droite, hauteurMax, sol) {
    const n = Math.max(2, Math.round((droite - gauche) / NEIGE.colonne));
    const pas = (droite - gauche) / n;
    const base = Float32Array.from({ length: n }, (_, i) => sol(gauche + (i + 0.5) * pas));
    let s = neige.surfaces.get(cle);
    if (!s || s.n !== n) {
      const avant = s;
      const h = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (avant) h[i] = avant.h[Math.floor((i * avant.n) / n)];
        // La première fois, une fine couche sur le plat, pour que rien ne soit jamais nu.
        else if (Math.abs((base[Math.min(i + 1, n - 1)] || 0) - base[i]) < 0.5) h[i] = 1.2 + Math.random() * 1.2;
      }
      s = { cle, n, h, surplus: [0, 0] };
      neige.surfaces.set(cle, s);
    }
    Object.assign(s, { gauche, droite, pas, base, hauteurMax, visible: true });
  }

  // Un flocon qui se pose : un petit tas en cloche autour de l'endroit où il est tombé.
  function deposer(s, x, quantite) {
    const centre = Math.round((x - s.gauche) / s.pas - 0.5);
    for (let k = -5; k <= 5; k++) {
      const i = centre + k;
      if (i < 0 || i >= s.n) continue;
      s.h[i] = Math.min(s.hauteurMax, s.h[i] + (quantite * Math.exp(-(k * k) / 8)) / 4.99);
    }
  }

  // La neige glisse d'une colonne vers sa voisine plus basse tant que l'écart dépasse la
  // pente tolérée. Aux bouts, au-delà de la corniche, le surplus s'accumule puis tombe en
  // motte.
  function tasser(s) {
    const { h, base, n } = s;
    for (let passe = 0; passe < 2; passe++) {
      for (let i = 0; i < n - 1; i++) {
        const ecart = base[i + 1] - h[i + 1] - (base[i] - h[i]); // positif : i est plus haut
        if (ecart > NEIGE.pente && h[i] > 0) {
          const q = Math.min(h[i], (ecart - NEIGE.pente) / 2);
          h[i] -= q;
          h[i + 1] += q;
        } else if (-ecart > NEIGE.pente && h[i + 1] > 0) {
          const q = Math.min(h[i + 1], (-ecart - NEIGE.pente) / 2);
          h[i + 1] -= q;
          h[i] += q;
        }
      }
    }
    const corniche = s.hauteurMax * 0.5;
    [0, n - 1].forEach((i, cote) => {
      if (h[i] > corniche) {
        s.surplus[cote] += h[i] - corniche;
        h[i] = corniche;
      }
      if (s.surplus[cote] > 3) {
        const x = cote ? s.droite + 2 : s.gauche - 2;
        lacherMotte(x, base[i] - corniche * 0.5, 1.4 + Math.random(), (cote ? 1 : -1) * (15 + Math.random() * 25), 10);
        s.surplus[cote] = 0;
      }
    });
    for (let i = 0; i < n; i++) if (h[i] > s.hauteurMax) h[i] = s.hauteurMax;
  }

  function lacherMotte(x, y, taille, vx, vy) {
    if (neige.mottes.length < 60) neige.mottes.push({ x, y, taille, vx, vy });
  }

  // Le tas : le dessus lissé en courbes ; à chaque bout, la neige dépasse un peu de l'objet
  // en bourrelet arrondi (la corniche) avant de rejoindre son pied, qui suit l'objet. Une
  // ombre lavande dessous le détache du verre blanc.
  function dessinerTas(d, s) {
    const { n, pas, base, h } = s;
    const bordG = Math.min(4, h[0] * 0.8);
    const bordD = Math.min(4, h[n - 1] * 0.8);
    const points = [];
    let haut = Infinity;
    let bas = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = base[i] - h[i];
      points.push([s.gauche + (i + 0.5) * pas, y]);
      haut = Math.min(haut, y);
      bas = Math.max(bas, base[i]);
    }
    const [x0, y0] = points[0];
    const [xn, yn] = points[n - 1];
    d.beginPath();
    d.moveTo(x0, base[0] + 0.8);
    d.bezierCurveTo(x0 - bordG * 1.6, base[0] + 0.8 + bordG * 0.4, x0 - bordG * 1.4, y0, x0, y0);
    for (let k = 1; k < n - 1; k++) {
      const [x, y] = points[k];
      const [x2, y2] = points[k + 1];
      d.quadraticCurveTo(x, y, (x + x2) / 2, (y + y2) / 2);
    }
    d.lineTo(xn, yn);
    d.bezierCurveTo(xn + bordD * 1.4, yn, xn + bordD * 1.6, base[n - 1] + 0.8 + bordD * 0.4, xn, base[n - 1] + 0.8);
    for (let i = n - 2; i >= 0; i--) d.lineTo(s.gauche + (i + 0.5) * pas, base[i] + 0.8);
    d.closePath();
    d.save();
    d.translate(0, 1.4);
    d.fillStyle = "rgba(110, 28, 112, 0.3)";
    d.fill();
    d.restore();
    const degrade = d.createLinearGradient(0, haut, 0, bas + 1);
    degrade.addColorStop(0, "#ffffff");
    degrade.addColorStop(0.45, "#faf7fc");
    degrade.addColorStop(1, "#dccfe9");
    d.fillStyle = degrade;
    d.fill();
    d.strokeStyle = "rgba(152, 40, 152, 0.1)";
    d.lineWidth = 0.7;
    d.stroke();
  }

  // Toucher un onglet ou le bouton fait tomber la neige qui est juste dessus, en mottes qui
  // sautent un peu avant de tomber. Le reste de la barre garde la sienne. Faire défiler la
  // page ne fait rien (Sébastien, 27 novembre 2026).
  function secouerNeige(evenement) {
    if (!neige.voulue || !evenement.target.closest) return;
    const cible = evenement.target.closest(".onglet, .bouton-flottant");
    if (!cible) return;
    const s = neige.surfaces.get(cible.classList.contains("bouton-flottant") ? "rond" : "barre");
    if (!s || !s.visible) return;
    const r = cible.getBoundingClientRect();
    for (let i = 0; i < s.n; i++) {
      const x = s.gauche + (i + 0.5) * s.pas;
      if (x < r.left - 4 || x > r.right + 4 || s.h[i] < 0.8) continue;
      if (i % 2 === 0) lacherMotte(x, s.base[i] - s.h[i], 1 + s.h[i] * 0.22, (Math.random() - 0.5) * 90, -60 - Math.random() * 90);
      s.h[i] = 0.3 + Math.random() * 0.4;
    }
  }

  function demarrerNeige() {
    neige.toile.hidden = false;
    dimensionnerNeige();
    if (!neige.boucle) {
      neige.image = 0;
      neige.boucle = requestAnimationFrame(animerNeige);
    }
  }

  function arreterNeige() {
    if (neige.boucle) cancelAnimationFrame(neige.boucle);
    neige.boucle = 0;
    neige.mottes.length = 0;
    if (neige.toile) neige.toile.hidden = true;
  }

  function animerNeige(instant) {
    neige.boucle = requestAnimationFrame(animerNeige);
    if (neige.image && instant - neige.image < 32) return; // trente images par seconde suffisent
    const duree = neige.image ? Math.min((instant - neige.image) / 1000, 0.1) : 0;
    neige.image = instant;
    if (instant - neige.mesure > 1000) {
      // Filet de sécurité, là où la surveillance de taille n'existe pas : une toile dont la
      // taille a changé est redimensionnée avant d'être mesurée.
      const echelle = Math.min(window.devicePixelRatio || 1, 2);
      if (Math.round(neige.toile.clientHeight * echelle) !== neige.toile.height || Math.round(neige.toile.clientWidth * echelle) !== neige.toile.width) {
        dimensionnerNeige();
      }
      mesurerSurfaces();
      neige.mesure = instant;
    }
    const { dessin, toile, flocons, mottes } = neige;
    const largeur = toile.clientWidth;
    const hauteur = toile.clientHeight;
    const surfaces = [];
    neige.surfaces.forEach((s) => s.visible && surfaces.push(s));
    dessin.clearRect(0, 0, largeur, hauteur);

    for (let i = 0; i < flocons.length; i++) {
      const f = flocons[i];
      f.y += f.vitesse * duree;
      f.phase += duree * 0.9;
      const x = f.x + Math.sin(f.phase) * f.ampleur;
      let pose = false;
      for (const s of surfaces) {
        if (x < s.gauche || x >= s.droite) continue;
        const c = Math.min(s.n - 1, Math.floor((x - s.gauche) / s.pas));
        if (f.y >= s.base[c] - s.h[c] - 1 && f.y <= s.base[c] + 12) {
          // Le bouton, petit, reçoit peu de flocons : chacun y compte double.
          deposer(s, x, NEIGE.depot * (f.rayon / 2.3) * (s.cle === "rond" ? 2 : 1));
          pose = true;
          break;
        }
      }
      if (pose || f.y > hauteur + 6) {
        flocons[i] = nouveauFlocon(largeur, hauteur, false);
        continue;
      }
      const taille = f.rayon * 3.6;
      dessin.drawImage(neige.flocon, x - taille / 2, f.y - taille / 2, taille, taille);
    }

    for (const s of surfaces) {
      tasser(s);
      dessinerTas(dessin, s);
    }

    for (let i = mottes.length - 1; i >= 0; i--) {
      const m = mottes[i];
      m.vy += 900 * duree;
      m.x += m.vx * duree;
      m.y += m.vy * duree;
      if (m.y > hauteur + 20) {
        mottes.splice(i, 1);
        continue;
      }
      const taille = m.taille * 3.6;
      dessin.drawImage(neige.flocon, m.x - taille / 2, m.y - taille / 2, taille, taille);
    }
  }

  // Un vrai toucher seulement (« click ») : le téléphone ne l'envoie pas quand le doigt glisse
  // pour faire défiler. Écouté avant l'application (« true ») : le bouton des notes existe
  // encore quand on mesure ce qu'il porte, juste avant que l'écran change.
  document.addEventListener("click", secouerNeige, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) arreterNeige();
    else if (neige.voulue) demarrerNeige();
  });
  if (mouvementReduit.addEventListener) mouvementReduit.addEventListener("change", () => afficher());

  // ---------------------------------------------------------------------------
  // La barre des sections, en bas
  // ---------------------------------------------------------------------------
  //
  // Cinq onglets, toujours sous le pouce : accueil, sujets, défis, agenda, plus. Elle est
  // là sur tous les écrans de l'application, sauf quand on écrit — le clavier prend la
  // place — et sur l'écran d'installation, qui n'a rien à proposer d'autre.

  const ONGLETS = [
    { nom: "accueil", aller: "", icone: () => MAISON },
    { nom: "sujets", aller: "sujets", icone: () => LIVRE },
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
      <span class="onglets__bulle" aria-hidden="true"></span>
      ${ONGLETS.map(
        (o) => html`<button type="button" class="onglet" data-onglet="${o.nom}" data-aller="${o.aller}">
          <span class="onglet__icone">${o.icone()}</span>
          <span class="onglet__nom">${echapper(ui.onglets[o.nom])}</span>
        </button>`
      ).join("")}
    </div>`;
  }

  // Quel onglet s'allume pour quel écran : l'intérieur d'un sujet allume « Sujets » (« Défis »
  // pour un projet), un défi « Défis », Pratique ou la sauvegarde « Plus ».
  function ongletDe(ecran, id) {
    if (ecran === "accueil" || ecran === "notes" || ecran === "note") return "accueil";
    if (ecran === "sujet" || ecran.startsWith("sujet-") || ecran === "question") {
      return index && estProjet(index.sujets.find((s) => s.id === id)) ? "defis" : "sujets";
    }
    if (ecran === "sujets") return "sujets";
    if (ecran === "defis" || ecran === "defi") return "defis";
    if (ecran === "agenda") return "agenda";
    return "plus";
  }

  function reglerOnglets(ecran, id) {
    const nav = document.getElementById("onglets");
    if (!nav) return;
    nav.hidden = ecran === "installation" || ecran === "question" || ecran === "sujet-notes" || ecran === "note";
    reglerNeige(ecran, nav.hidden);
    const actif = ongletDe(ecran, id);
    nav.querySelectorAll(".onglet").forEach((bouton) => {
      if (bouton.dataset.onglet === actif) bouton.setAttribute("aria-current", "page");
      else bouton.removeAttribute("aria-current");
    });
    // La bulle glisse jusqu'à l'onglet allumé (« --onglet » : son rang, de 0 à 4) et s'étire
    // un instant en chemin, comme une goutte. Demandé par Sébastien le 12 novembre 2026,
    // « comme sur Musique d'Apple ». À l'ouverture, elle se pose sans bouger.
    const rang = String(ONGLETS.findIndex((o) => o.nom === actif));
    const avant = nav.style.getPropertyValue("--onglet");
    if (avant === rang) return;
    nav.style.setProperty("--onglet", rang);
    const bulle = nav.querySelector(".onglets__bulle");
    if (!bulle || avant === "") return;
    bulle.classList.remove("onglets__bulle--bouge");
    void bulle.offsetWidth; // relance l'étirement à chaque déplacement
    bulle.classList.add("onglets__bulle--bouge");
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

    // Un projet se présente comme un défi : l'étiquette « Défi » et son texte en tête, sans
    // fiche « À propos » à ouvrir. Il ne s'archive pas : l'onglet Défis n'a pas d'archives.
    const projet = estProjet(sujet);
    const archive = !projet && sujetArchive(sujet.id);
    // Un sujet peut porter des liens (un document à lire, Gospel Street Moment, novembre 2026),
    // et un projet peut n'avoir aucune question : il ne reste alors que le document et « Mes
    // réflexions ». Sans question, pas de partage : ces notes sont personnelles.
    const aDesQuestions = sujet.questions.length > 0;
    const liens = (sujet.liens || []).filter((l) => l && l.url);
    const etiquette = projet ? ui.defi.defi : archive ? s.archive : "";
    // « À propos de cette étude » ne s'affiche que si le responsable a écrit une présentation
    // ou une mise en garde : sans elles, la ligne menait à un écran presque vide.
    const aLire = Boolean((sujet.intro && sujet.intro.length) || sujet.avertissement);

    return html`
      <section class="page">
        <header class="page__entete page__entete--affiche">
          ${etiquette ? html`<span class="etiquette">${echapper(etiquette)}</span>` : ""}
          <h1 class="page__titre">${echapper(sujet.titre)}</h1>
          ${sujet.sousTitre ? html`<p class="page__soustitre">${echapper(sujet.sousTitre)}</p>` : ""}
        </header>

        ${projet
          ? sujet.description ? html`<div class="page__contenu"><p>${echapper(sujet.description)}</p></div>` : ""
          : aLire
            ? html`<ul class="fiches">
                ${carte({ aller: base + "a-propos", classe: "fiche--a-propos", pastille: pastille(INFO), titre: s.aPropos })}
              </ul>`
            : ""}

        ${liens.length ? html`<ul class="fiches">${liens.map((l) => lienExterne(l)).join("")}</ul>` : ""}

        ${aDesQuestions
          ? html`<h2 class="section-titre">${echapper(s.questions)}</h2>
            <ul class="fiches">${questions}</ul>`
          : ""}
        <ul class="fiches fiches--suite">
          ${versets}
          ${sujet.reflexions === false
            ? ""
            : html`<li>
                <button type="button" class="fiche fiche--notes" data-aller="${base}notes">
                  ${pastille(AMPOULE)}
                  <span class="fiche__texte"><span class="fiche__titre">${echapper(s.reflexions)}</span></span>
                  ${CHEVRON_DROIT}
                </button>
              </li>`}
          ${aDesQuestions
            ? carte({ aller: base + "partager", classe: "fiche--partager", pastille: pastille(PARTAGE, "fiche__pastille--vive"), titre: s.partagerReponses })
            : ""}
        </ul>

        ${projet
          ? ""
          : html`<div class="sujet__archive">
              ${archive ? html`<p class="sujet__archive-aide">${echapper(s.desarchiverAide)}</p>` : ""}
              <button type="button" class="sujet__archive-lien" data-archiver="${echapper(sujet.id)}">${echapper(archive ? s.desarchiver : s.archiver)}</button>
            </div>`}
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
  // « intituleCache » : quand l'intitulé ne fait que redire le nom de l'écran, déjà écrit
  // dans la barre du haut (« Mes réflexions »), il n'est plus affiché ; il reste dans la
  // page pour nommer la zone d'écriture aux lecteurs d'écran.
  function ecranEcriture(cle, intitule, placeholder, pied = "", intituleCache = false) {
    const texte = lire(cle) || "";
    return html`
      <section class="question" aria-labelledby="intitule">
        <h1 class="${intituleCache ? "lu" : "question__intitule"}" id="intitule">${echapper(intitule)}</h1>
        <textarea
          class="question__reponse"
          id="zone-${echapper(cle).replace(/[^a-zA-Z0-9-]/g, "-")}"
          data-cle="${echapper(cle)}"
          aria-labelledby="intitule"
          placeholder="${echapper(placeholder)}"
        >${echapper(texte)}</textarea>
        <p class="question__pied">
          ${pied}
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
    return ecranEcriture("sujet:" + sujet.id + ":notes", n.titre, n.placeholder, "", true);
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
          <p class="partage__comment">${echapper((estProjet(sujet) && s.commentDefi) || s.comment)}</p>
          <label class="champ">
            <span class="champ__intitule">${echapper(s.prenom)}</span>
            <input
              class="champ__saisie"
              type="text"
              id="prenom"
              value="${echapper(prenom)}"
              autocomplete="given-name"
              maxlength="40"
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
  // Mes notes : la liste, la recherche, une note
  // ---------------------------------------------------------------------------

  // La recherche s'affiche à partir de cinq notes : avant, tout tient sous les yeux.
  const NOTES_AVANT_RECHERCHE = 5;

  function dateNote(id) {
    return new Date(Number(id)).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }).replace(/^1 /, "1er ");
  }

  // Sans majuscules ni accents : « priere » retrouve « Prière ».
  function sansAccents(texte) {
    return texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function lignesNotes(notes, recherche) {
    const n = ui.notes;
    if (!notes.length) return html`<li><p class="vide">${echapper(n.aucune)}</p></li>`;
    const cherche = sansAccents(recherche.trim());
    const trouvees = cherche ? notes.filter((note) => sansAccents(note.texte).includes(cherche)) : notes;
    return trouvees
      .map((note) => {
        const premiere = note.texte.trim().split("\n")[0].trim();
        return carte({
          aller: "note/" + note.id,
          classe: "fiche--note",
          pastille: pastille(CRAYON),
          titre: premiere.length > 80 ? premiere.slice(0, 79).trimEnd() + "…" : premiere,
          sous: dateNote(note.id),
        });
      })
      .join("");
  }

  function ecranMesNotes() {
    const n = ui.notes;
    const notes = lireNotes();
    return html`
      <section class="page">
        <button type="button" class="bouton-principal" data-nouvelle-note>${echapper(n.nouvelle)}</button>
        ${notes.length >= NOTES_AVANT_RECHERCHE
          ? html`<label class="champ notes__recherche">
              <span class="champ__intitule">${echapper(n.rechercher)}</span>
              <input class="champ__saisie" type="search" id="recherche-notes" autocomplete="off" enterkeyhint="search" />
            </label>`
          : ""}
        <p class="notes__resultat" id="resultat-notes" role="status"></p>
        <ul class="fiches" id="liste-notes">${lignesNotes(notes, "")}</ul>
      </section>
    `;
  }

  function ecranNote(id) {
    const n = ui.notes;
    const supprimer = html`<button type="button" class="note__supprimer" data-supprimer-note="${echapper(id)}">${echapper(n.supprimer)}</button>`;
    return ecranEcriture("note:" + id, remplir(n.du, { date: dateNote(id) }), n.placeholder, supprimer);
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
        <header class="page__entete page__entete--affiche">
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
        ${aVenir.length
          ? html`<ul class="evenements">${ligneEvenement(aVenir[0], { vedette: true })}</ul>`
          : html`<p class="vide">${echapper(a.rien)}</p>`}
        ${aVenir.length > 1
          ? html`<h2 class="liste-titre">${echapper(a.suivantes)}</h2>
              <ul class="evenements evenements--suite">${aVenir.slice(1).map((e) => ligneEvenement(e, { calendrier: true })).join("")}</ul>`
          : ""}
        ${passes.length
          ? html`<details class="passes">
              <summary class="section-titre passes__titre">${echapper(a.passe)}</summary>
              <ul class="evenements evenements--suite evenements--passes">${passes.map((e) => ligneEvenement(e)).join("")}</ul>
            </details>`
          : ""}
      </section>
    `;
  }

  // ---------------------------------------------------------------------------
  // Pratique : les liens utiles
  // ---------------------------------------------------------------------------

  function lienExterne(lien, icone = EXTERIEUR) {
    return html`
      <li>
        <a class="fiche fiche--lien" href="${echapper(lien.url)}" target="_blank" rel="noopener">
          <span class="fiche__pastille">${icone}</span>
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
          <ul class="fiches">${(section.liens || []).map((lien) => lienExterne(lien)).join("")}</ul>
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
      remplirVersion();
      const zone = principal.querySelector(".question__reponse");
      if (zone) ajusterHauteur(zone);
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
    reglerOnglets(route.ecran, route.id);
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
          montrer(ecranSujet(sujet), sujet.titre, estProjet(sujet) ? "defis" : "sujets");
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
    // Mes notes dépend de l'accueil, d'où l'on y entre par le bouton flottant.
    if (route.ecran === "notes") return montrer(ecranMesNotes(), ui.notes.titre, "");
    if (route.ecran === "note") return montrer(ecranNote(route.id), ui.notes.note, "notes");
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
      if (cle.startsWith("note:") && !cible.value.trim()) {
        effacer(cle);
        signalerEnregistrement(cle);
        return;
      }
      if (ecrire(cle, cible.value)) signalerEnregistrement(cle);
      return;
    }

    // La recherche refait la liste seule : le champ garde le clavier.
    if (cible.id === "recherche-notes") {
      const n = ui.notes;
      const notes = lireNotes();
      const liste = document.getElementById("liste-notes");
      const resultat = document.getElementById("resultat-notes");
      const lignes = lignesNotes(notes, cible.value);
      liste.innerHTML = lignes;
      const trouvees = liste.querySelectorAll(".fiche--note").length;
      if (!cible.value.trim()) resultat.textContent = "";
      else if (!trouvees) resultat.textContent = remplir(n.aucunResultat, { recherche: cible.value.trim() });
      else resultat.textContent = trouvees === 1 ? n.resultat : remplir(n.resultats, { n: trouvees });
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

  // Une liste repliable retient son état : « toggle » ne remonte pas dans la page, d'où
  // l'écoute en capture. Repliée, on ne garde rien ; ouverte, on le note.
  document.addEventListener(
    "toggle",
    (evenement) => {
      const bloc = evenement.target;
      if (!bloc.dataset || !bloc.dataset.deplie) return;
      if (bloc.open) ecrire("deplie:" + bloc.dataset.deplie, "1");
      else effacer("deplie:" + bloc.dataset.deplie);
    },
    true
  );

  document.addEventListener("click", async (evenement) => {
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

    // Une nouvelle note n'existe qu'à la première lettre : ouvrir puis revenir sans rien
    // écrire ne laisse rien derrière.
    if (evenement.target.closest("[data-nouvelle-note]")) {
      aller("note/" + Date.now());
      return;
    }

    // Supprimer une note : deux temps, comme l'effacement des réglages. On revient à la liste
    // en remplaçant l'adresse, pour que le retour ne rouvre pas une note qui n'existe plus.
    const supprimer = evenement.target.closest("[data-supprimer-note]");
    if (supprimer) {
      if (supprimer.dataset.confirme !== "oui") {
        supprimer.dataset.confirme = "oui";
        supprimer.textContent = ui.notes.confirmerSupprimer;
        return;
      }
      effacer("note:" + supprimer.dataset.supprimerNote);
      location.replace("#/notes");
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

    // Archiver une étude, ou la ressortir, depuis le bas de l'étude. Rien n'est effacé : seule
    // la place change. L'écran se refait sur place, sans l'animation ni le retour en haut
    // d'afficher() : le jeune voit le lien devenir « Remettre dans mes études » là où il vient
    // de toucher. (Ni glissement ni bouton sur les cartes de la liste : retirés le
    // 11 septembre 2026, l'un « bugait » sur iPhone, l'autre n'était « pas esthétique ».)
    const archiver = evenement.target.closest("[data-archiver]");
    if (archiver) {
      const cle = "archive:sujet:" + archiver.dataset.archiver;
      if (lire(cle)) effacer(cle);
      else ecrire(cle, new Date().toISOString().slice(0, 10));
      if (sujetCourant && sujetCourant.id === archiver.dataset.archiver) {
        principal.innerHTML = ecranSujet(sujetCourant);
        const lien = principal.querySelector("[data-archiver]");
        if (lien) {
          lien.focus({ preventScroll: true });
          // La phrase « Cette étude est archivée » allonge la page : le lien passait sous la
          // barre d'onglets (vu sur le simulateur). On remonte juste ce qu'il faut.
          const barre = document.getElementById("onglets");
          const limite = barre && !barre.hidden ? barre.getBoundingClientRect().top : window.innerHeight;
          const depasse = lien.getBoundingClientRect().bottom + 16 - limite;
          if (depasse > 0) window.scrollBy(0, depasse);
        }
      } else {
        afficher();
      }
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
    // Le numéro du code réellement à l'écran, porté par son adresse (app.js?v=1.4.2, depuis
    // novembre 2026). Le nom du cache, lu ensuite en secours, retarde d'une ouverture : la
    // nouvelle copie s'installe une seconde après le chargement de la page.
    const script = document.querySelector('script[src*="app.js?v="]');
    const duScript = script && new URL(script.src).searchParams.get("v");
    if (duScript) {
      versionInstallee = duScript;
      remplirVersion();
      return;
    }
    if (!("caches" in window)) return;
    caches
      .keys()
      .then((noms) => {
        const toutes = noms.filter((nom) => nom.startsWith("gdj-")).map((nom) => nom.slice("gdj-".length));
        // Numérotation 1.0.0 depuis le 11 septembre 2026. Pendant la seconde où l'ancienne
        // copie (numérotée par date, 2026-09-11-5) existe encore, c'est la nouvelle qui compte.
        const troisChiffres = toutes.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
        const versions = troisChiffres.length ? troisChiffres : toutes;
        versions.sort((a, b) => b.localeCompare(a, "fr", { numeric: true }));
        versionInstallee = versions[0] || "";
        remplirVersion();
      })
      .catch(() => {});
  }

  // Écrit la version dans l'écran des réglages s'il est affiché. Appelé quand la version est
  // connue, et à chaque affichage d'écran : l'un ou l'autre peut arriver le premier (vu le
  // 11 septembre 2026 en ouvrant l'application directement sur les réglages).
  function remplirVersion() {
    const ligne = document.getElementById("version-app");
    if (ligne && versionInstallee) ligne.textContent = remplir(ui.reglages.version, { version: versionInstallee });
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
        <p class="reglages__version" id="version-app">${versionInstallee ? echapper(remplir(r.version, { version: versionInstallee })) : ""}</p>
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
      // À la toute première ouverture, le cache n'existe pas encore au démarrage : le service
      // worker le remplit juste après. On relit la version dès qu'il est prêt. Vu sur le
      // simulateur iPhone le 11 septembre 2026 : l'application installée a sa propre mémoire,
      // distincte de Safari, et la ligne de version manquait à la première ouverture.
      if ("serviceWorker" in navigator) navigator.serviceWorker.ready.then(lireVersionInstallee).catch(() => {});
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
