document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const loginSection = document.getElementById('loginSection');
    const uploadSection = document.getElementById('uploadSection');
    const loginForm = document.getElementById('loginForm');
    const uploadForm = document.getElementById('uploadForm');
    const logoutBtn = document.getElementById('logoutBtn');
    const statusMessage = document.getElementById('uploadStatus');
    const submitBtn = document.getElementById('submitCourseBtn');

    const TARGET_OWNER = 'AdlenSouci';
    const TARGET_REPO = 'projet_cours_eleves';

    // --- GitHub Credentials logic ---
    const checkLogin = () => {
        const token = localStorage.getItem('ghToken');

        if (token) {
            loginSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
        } else {
            loginSection.classList.remove('hidden');
            uploadSection.classList.add('hidden');
        }
    };

    const showError = (message) => {
        let errDiv = document.getElementById('loginError');
        if (!errDiv) {
            errDiv = document.createElement('div');
            errDiv.id = 'loginError';
            errDiv.className = 'status-message error';
            errDiv.style.marginBottom = '1.5rem';
            loginForm.insertBefore(errDiv, loginForm.firstChild);
        }
        errDiv.textContent = message;
        errDiv.classList.remove('hidden');
    };

    const hideError = () => {
        const errDiv = document.getElementById('loginError');
        if (errDiv) errDiv.classList.add('hidden');
    };

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();

        const submitBtn = loginForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner-small"></div> Vérification...';

        const token = document.getElementById('ghToken').value.trim();

        if (!token.startsWith('ghp_')) {
            return showError("Erreur : Ce jeton est invalide. Il doit commencer par 'ghp_'.");
        }

        // Test de connexion GitHub API réel
        try {
            const response = await fetch(`https://api.github.com/repos/${TARGET_OWNER}/${TARGET_REPO}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) {
                if (response.status === 401) throw new Error("Erreur : Le Token est invalide ou expiré.");
                throw new Error("Erreur système lors de la vérification.");
            }

            const data = await response.json();
            if (!data.permissions || !data.permissions.push) {
                throw new Error("Erreur : Ce Token n'a pas le droit d'ajouter des cours. La case 'repo' n'a pas été cochée sur GitHub.");
            }

            // Si ok et qu'on a les droits d'écriture, on sauvegarde
            localStorage.setItem('ghToken', token);
            checkLogin();

        } catch (error) {
            showError(error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
            lucide.createIcons();
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('ghToken');
        checkLogin();
    });

    // --- GitHub API Helpers ---
    const apiCall = async (endpoint, method = 'GET', body = null) => {
        const token = localStorage.getItem('ghToken');

        const url = `https://api.github.com/repos/${TARGET_OWNER}/${TARGET_REPO}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        const config = { method, headers };
        if (body) config.body = JSON.stringify(body);

        const response = await fetch(url, config);
        // Si c'est un GET et une 404, on gère l'erreur silencieusement en renvoyant null
        if (method === 'GET' && response.status === 404) {
            return null;
        }
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.message || 'Erreur API GitHub');
        }
        return await response.json();
    };

    // --- Upload Logic ---
    const uploadFile = async (path, content, message, oldSha = null) => {
        const body = {
            message: message,
            content: content // base64
        };
        if (oldSha) body.sha = oldSha;
        return apiCall(`/contents/${path}`, 'PUT', body);
    };

    const arrayBufferToBase64 = (buffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    };

    const setStatus = (msg, isError = false) => {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
        statusMessage.classList.remove('hidden');
    };

    // --- Form Submission ---
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner-small"></div> Chargement...';
        setStatus("Préparation des fichiers...", false);

        try {
            // 1. Get Form Values
            const title = document.getElementById('courseTitle').value;
            const type = document.getElementById('courseType').value;
            const desc = document.getElementById('courseDesc').value;
            const duration = document.getElementById('courseDuration').value;
            const fileInput = document.getElementById('courseFile').files[0];

            if (!fileInput) throw new Error("Veuillez sélectionner un fichier HTML.");

            // 2. Read File as Base64
            const arrayBuffer = await fileInput.arrayBuffer();
            const base64Content = arrayBufferToBase64(arrayBuffer);

            // Clean filename
            const timestamp = new Date().getTime();
            const fileName = `cours_${timestamp}.html`;
            const filePath = `cours/${fileName}`;

            // 3. Upload HTML File
            setStatus("Envoi du fichier HTML sur le dépôt...", false);
            await uploadFile(filePath, base64Content, `[Admin] Ajout de la leçon: ${title}`);

            // 4. Update cours.json
            setStatus("Mise à jour du catalogue de cours...", false);
            let coursJsonData = [];
            let jsonSha = null;

            try {
                // Try fetching existing cours.json
                const jsonFile = await apiCall('/contents/data/cours.json');
                if (jsonFile && jsonFile.content) {
                    const decodedJson = decodeURIComponent(escape(atob(jsonFile.content)));
                    coursJsonData = JSON.parse(decodedJson);
                    jsonSha = jsonFile.sha;
                }
            } catch (err) {
                // Mauvais json ou erreur inattendue
                console.warn("Erreur lors de la lecture du JSON existant:", err);
            }

            // Create new entry
            const newCourse = {
                id: `ID_${timestamp}`,
                title: title,
                description: desc,
                type: type,
                date: new Date().toISOString().split('T')[0],
                duration: duration || "Non spécifié",
                file: `./${filePath}`
            };

            coursJsonData.unshift(newCourse); // Add to beginning

            // Base64 encode JSON
            const jsonString = JSON.stringify(coursJsonData, null, 2);
            // Handling UTF-8 in Base64
            const jsonBase64 = btoa(unescape(encodeURIComponent(jsonString)));

            await uploadFile('data/cours.json', jsonBase64, `[Admin] Mise à jour du catalogue suite à l'ajout: ${title}`, jsonSha);

            // Success
            setStatus("Succès ! Le cours a été publié sur le site.", false);
            uploadForm.reset();

        } catch (error) {
            console.error("Erreur Upload:", error);
            setStatus(`Erreur : ${error.message}`, true);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="send"></i> Publier sur le site';
            lucide.createIcons();
        }
    });

    // Initialize
    checkLogin();
});
