const data=[['Петренко Ол// ==========================================
// TRORECRUITER CRM — SUPABASE
// ==========================================

async function getCandidates() {
    const { data, error } = await supabaseClient
        .from('candidates')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Помилка завантаження кандидатів:', error);
        return [];
    }

    return data || [];
}


// ==========================================
// ЛІЧИЛЬНИКИ НА ГОЛОВНІЙ
// ==========================================

async function updateDashboard() {

    const candidates = await getCandidates();

    const { count: personalFiles } = await supabaseClient
        .from('personal_files')
        .select('*', {
            count: 'exact',
            head: true
        });

    const { count: documents } = await supabaseClient
        .from('documents')
        .select('*', {
            count: 'exact',
            head: true
        });

    const cards = document.querySelectorAll('.card-number');

    if (cards[0]) {
        cards[0].textContent = candidates.length;
    }

    if (cards[1]) {
        cards[1].textContent = personalFiles || 0;
    }

    if (cards[2]) {
        cards[2].textContent = documents || 0;
    }
}


// ==========================================
// СПИСОК КАНДИДАТІВ
// ==========================================

async function showCandidates() {

    const content = document.querySelector('.content');

    if (!content) return;

    const candidates = await getCandidates();

    content.innerHTML = `
        <div class="page-title">
            Кандидати
        </div>

        <div class="page-subtitle">
            База кандидатів TRORECRUITER
        </div>

        <div style="
            background:#18232d;
            border:1px solid #293742;
            border-radius:12px;
            overflow:hidden;
        ">

            <table style="
                width:100%;
                border-collapse:collapse;
            ">

                <thead>
                    <tr style="
                        background:#1d2a35;
                        text-align:left;
                    ">
                        <th style="padding:15px">ПІБ</th>
                        <th style="padding:15px">Телефон</th>
                        <th style="padding:15px">Посада</th>
                        <th style="padding:15px">Напрям</th>
                        <th style="padding:15px">Статус</th>
                    </tr>
                </thead>

                <tbody>

                    ${
                        candidates.length === 0

                        ?

                        `
                        <tr>
                            <td colspan="5"
                                style="
                                    padding:40px;
                                    text-align:center;
                                    color:#8997a3;
                                ">
                                Кандидатів поки немає
                            </td>
                        </tr>
                        `

                        :

                        candidates.map(candidate => `

                            <tr style="
                                border-top:1px solid #293742;
                            ">

                                <td style="padding:15px">
                                    <b>
                                        ${escapeHtml(candidate.full_name || '')}
                                    </b>
                                </td>

                                <td style="padding:15px">
                                    ${escapeHtml(candidate.phone || '—')}
                                </td>

                                <td style="padding:15px">
                                    ${escapeHtml(candidate.desired_position || '—')}
                                </td>

                                <td style="padding:15px">
                                    ${escapeHtml(candidate.direction || '—')}
                                </td>

                                <td style="padding:15px">
                                    ${escapeHtml(candidate.recruitment_status || 'Новий')}
                                </td>

                            </tr>

                        `).join('')
                    }

                </tbody>

            </table>

        </div>
    `;

}


// ==========================================
// НОВА ОСОБОВА СПРАВА
// ==========================================

function showNewCandidateForm() {

    const content = document.querySelector('.content');

    if (!content) return;

    content.innerHTML = `

        <div class="page-title">
            Нова особова справа
        </div>

        <div class="page-subtitle">
            Створення нового кандидата
        </div>


        <form id="candidateForm"
              style="
                max-width:900px;
                background:#18232d;
                border:1px solid #293742;
                border-radius:12px;
                padding:30px;
              ">


            <label>ПІБ</label>

            <input
                name="full_name"
                required
                placeholder="Прізвище Ім'я По батькові"
            >


            <label>Телефон</label>

            <input
                name="phone"
                placeholder="+380..."
            >


            <label>Email</label>

            <input
                name="email"
                type="email"
            >


            <label>Дата народження</label>

            <input
                name="birth_date"
                type="date"
            >


            <label>РНОКПП</label>

            <input
                name="rnokpp"
            >


            <label>Військове звання</label>

            <input
                name="military_rank"
            >


            <label>Цивільна професія</label>

            <input
                name="civilian_profession"
            >


            <label>Бажана посада</label>

            <input
                name="desired_position"
            >


            <label>Напрям</label>

            <input
                name="direction"
                placeholder="БпЛА, зв'язок, водії..."
            >


            <label>ТЦК</label>

            <input
                name="tcc"
            >


            <label>Статус ВЛК</label>

            <input
                name="vlk_status"
            >


            <label>Примітки</label>

            <textarea
                name="notes"
                style="
                    width:100%;
                    min-height:120px;
                    padding:13px;
                    border-radius:8px;
                    border:1px solid #3a4650;
                    background:#0f171e;
                    color:white;
                    resize:vertical;
                "
            ></textarea>


            <button
                type="submit"
                class="login-button"
                style="margin-top:25px"
            >
                Зберегти кандидата
            </button>

        </form>
    `;


    document
        .getElementById('candidateForm')
        .addEventListener('submit', saveCandidate);

}


// ==========================================
// ЗБЕРЕЖЕННЯ КАНДИДАТА
// ==========================================

async function saveCandidate(event) {

    event.preventDefault();

    const form = event.target;

    const formData = new FormData(form);

    const {
        data: {
            user
        }
    } = await supabaseClient.auth.getUser();


    const candidate = {

        full_name: formData.get('full_name'),

        phone: formData.get('phone'),

        email: formData.get('email'),

        birth_date:
            formData.get('birth_date') || null,

        rnokpp:
            formData.get('rnokpp'),

        military_rank:
            formData.get('military_rank'),

        civilian_profession:
            formData.get('civilian_profession'),

        desired_position:
            formData.get('desired_position'),

        direction:
            formData.get('direction'),

        tcc:
            formData.get('tcc'),

        vlk_status:
            formData.get('vlk_status'),

        notes:
            formData.get('notes'),

        recruitment_status:
            'Новий',

        recruiter_id:
            user ? user.id : null
    };


    const {
        data,
        error
    } = await supabaseClient
        .from('candidates')
        .insert(candidate)
        .select()
        .single();


    if (error) {

        console.error(error);

        alert(
            'Не вдалося зберегти кандидата: ' +
            error.message
        );

        return;
    }


    // автоматично створюємо особову справу

    const {
        error: personalFileError
    } = await supabaseClient
        .from('personal_files')
        .insert({

            candidate_id: data.id

        });


    if (personalFileError) {

        console.error(
            'Помилка створення особової справи:',
            personalFileError
        );

    }


    alert('Кандидата успішно додано');


    updateDashboard();

    showCandidates();
}


// ==========================================
// БЕЗПЕЧНЕ ВИВЕДЕННЯ ТЕКСТУ
// ==========================================

function escapeHtml(value) {

    return String(value)

        .replaceAll('&', '&amp;')

        .replaceAll('<', '&lt;')

        .replaceAll('>', '&gt;')

        .replaceAll('"', '&quot;')

        .replaceAll("'", '&#039;');

}


// ==========================================
// МЕНЮ
// ==========================================

function setupMenu() {

    const menuItems =
        document.querySelectorAll('.menu-item');


    menuItems.forEach(item => {

        const text =
            item.textContent.trim();


        item.addEventListener('click', () => {

            menuItems.forEach(x =>
                x.classList.remove('active')
            );

            item.classList.add('active');


            if (text === 'Головна') {

                location.reload();

            }


            if (text === 'Кандидати') {

                showCandidates();

            }


            if (text === 'Нова особова справа') {

                showNewCandidateForm();

            }


            if (text === 'Документи') {

                alert(
                    'Розділ документів підключимо наступним етапом.'
                );

            }


            if (text === 'Пошук') {

                alert(
                    'Пошук кандидатів підключимо наступним етапом.'
                );

            }

        });

    });

}


// ==========================================
// ЗАПУСК
// ==========================================

async function startCRM() {

    await updateDashboard();

    setupMenu();

}


startCRM();ександр','Оператор БпЛА','Новий','Не проходив','Євген'],['Сидоренко Максим','Водій','Співбесіда','Придатний','Євген'],['Коваленко Віталій','Зв’язок','Документи','Очікується','Іван'],['Мельник Андрій','БпЛА','ВЛК','Направлений','Євген'],['Бондар Сергій','Старший водій','Призначений','Придатний','Іван']];function cls(s){return {Новий:'new',Співбесіда:'work',Документи:'doc',ВЛК:'vlk',Призначений:'done'}[s]}function draw(){let q=document.getElementById('q').value.toLowerCase(),f=document.getElementById('f').value;document.getElementById('rows').innerHTML=data.filter(x=>(!q||x.join(' ').toLowerCase().includes(q))&&(!f||x[2]==f)).map(x=>`<tr><td><b>${x[0]}</b></td><td>${x[1]}</td><td><span class="status ${cls(x[2])}">${x[2]}</span></td><td>${x[3]}</td><td>${x[4]}</td></tr>`).join('')}function openModal(){document.getElementById('modal').classList.add('show')}function closeModal(){document.getElementById('modal').classList.remove('show')}document.getElementById('form').onsubmit=e=>{e.preventDefault();let d=new FormData(e.target);data.unshift([d.get('name'),d.get('position')||'Не визначено','Новий','Не проходив','Євген']);draw();closeModal();e.target.reset();document.getElementById('new').textContent=+document.getElementById('new').textContent+1};draw();
