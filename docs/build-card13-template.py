"""Recreate the user's two-page Appendix 13 scan as a clean, fillable A4 blank."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import black, white

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'templates/fonts/DejaVuSans.ttf'
pdfmetrics.registerFont(TTFont('FormText', str(FONT)))
OUT = ROOT / 'templates/card13-blank.pdf'
c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle('Додаток 13. Картка обстеження та медичного огляду')
c.setAuthor('PSK_RECRUTER CRM')
W,H = A4

def text(x,y,s,size=9):
    c.setFont('FormText',size); c.setFillColor(black)
    c.drawString(x*mm,y*mm,s)
def center(y,s,size=9):
    c.setFont('FormText',size); c.drawCentredString(W/2,y*mm,s)
def line(x,y,w):
    c.setLineWidth(.45);c.line(x*mm,y*mm,(x+w)*mm,y*mm)
def field(name,x,y,w,h=6,multiline=False,value=''):
    c.acroForm.textfield(name=name,x=x*mm,y=y*mm,width=w*mm,height=h*mm,
        value='',fontName='Helvetica',fontSize=10,borderWidth=0,
        fillColor=white,textColor=black,forceBorder=False,
        fieldFlags='multiline' if multiline else '',maxlen=1200)
    line(x,y,w)
    if value:
        for i,s in enumerate(value.split('\n')):text(x+1,y+h-4-i*4,s,9)
def table(top,rows,columns,header=None):
    x=17; width=sum(columns);y=top
    if header:
        rows=[(header,13)]+rows
    for cells,height in rows:
        c.setLineWidth(.45); c.rect(x*mm,(y-height)*mm,width*mm,height*mm)
        cur=x
        for j,col in enumerate(columns):
            if j:c.line(cur*mm,y*mm,cur*mm,(y-height)*mm)
            parts=str(cells[j] if j<len(cells) else '').split('\n')
            for k,part in enumerate(parts):text(cur+2,y-4-k*3.6,part,8.3)
            cur+=col
        y-=height
    return y

# Front: identifying information and the first part of the investigation table.
text(113,282,'Додаток 13',9)
text(113,277,'до Положення про військово-лікарську',8.5)
text(113,272,'експертизу в Збройних Силах України',8.5)
text(113,267,'(пункт 5.1 глави 5 розділу II)',8.5)
c.rect(17*mm,247*mm,30*mm,40*mm)
text(19,267,'Фото 3×4 см',8)
text(19,262,'без головного',7.5)
text(19,258,'убору',7.5)
text(19,251,'М. П.',8)
text(53,248,'КНП «МКЛ № 6» ДМР',10)
line(53,246,140)
text(66,241,'(найменування закладу охорони здоров’я)',8)
center(230,'Картка',12)
center(223,'обстеження та медичного огляду',11)
field('category',17,215,176)
text(18,210,'Визначення придатності до військової служби',9)
center(206,'(вказати категорію особи, що оглядається, та мету медичного огляду)',7.7)
text(17,197,'1. Прізвище, ім’я, по батькові (за наявності), РНОКПП (серія (за наявності)',8.7)
text(17,192,'та номер паспорта для осіб, які відмовились від РНОКПП відповідно до закону)',8.7)
field('name_identifier',17,178,176,12,True)
text(17,171,'2. Дата народження (число, місяць, рік)',9)
field('birth_date',113,167,80)
text(17,161,'3. Військове звання',9);field('military_rank',64,157,129)
text(17,151,'4. Військова частина',9);field('military_unit',64,147,129)
text(17,141,'5. Військова служба у Збройних Силах України',9)
field('military_service',17,127,176,12,True)
text(17,119,'6. Відомості про підвищену чутливість (непереносимість) до хімічних речовин,',8.7)
text(17,114,'медикаментів, продуктів харчування тощо',8.7)
line(17,106,176);line(17,101,176)
text(17,94,'7. Дані про перебування на диспансерному обліку з приводу хронічних захворювань',8.2)
line(17,86,176);line(17,81,176)
text(17,78,'8. Результати додаткових методів обстеження:',9)
table(74,[
    (['Загальний аналіз крові','',''],7),
    (['Група крові та резус-фактор','',''],7),
    (['Біохімічний аналіз крові:\n- вміст глюкози\n- вміст білірубіну\n- вміст АЛТ\n- вміст загального білка','',''],19),
    (['Серологічний аналіз крові на:\n- ВІЛ\n- антиген вірусу гепатиту B (HBs Ag)\n- антитіла до вірусу гепатиту C (antiHCV)','',''],16)
], [90,27,59], ['Назва дослідження','Дата','Результат\n(включаючи код, згідно з НК\n026)'])
c.showPage()

# Reverse: remaining investigations, specialists, acknowledgement and VLK decision.
table(282,[
    (['Реакція мікропреципітації з кардіоліпіновим\nантигеном (RW)','',''],12),
    (['Загальний аналіз сечі','',''],9),
    (['Флюорографія органів грудної клітки','',''],9),
    (['ЕКГ','',''],9),
    (['Інші дослідження','',''],9),
],[90,27,59])
text(17,226,'9. Результати медичного обстеження спеціалістами:',9)
table(222,[( [label,'','',''],7) for label in [
    'Зріст/вага тіла','Терапевт','Хірург','Невропатолог','Офтальмолог','ЛОР',
    'Дерматовенеролог','Психіатр','Стоматолог','Гінеколог (при огляді жінок)','Інші лікарі-спеціалісти'
]], [65,25,60,26], ['', 'Дата','Діагноз\n(включаючи код, згідно з НК\n025)','Підпис\nлікаря'])
text(17,123,'10. Інформація щодо стану мого здоров’я надана мною в повному обсязі. Попереджений',8.5)
text(17,118,'про надання неповної та недостовірної інформації.',8.5)
text(17,110,'Підпис обстежуваного');line(69,109,78)
text(17,101,'11. Діагноз (включаючи код, згідно з НК 025) та постанова ВЛК:',8.8)
line(17,92,176);line(17,86,176);line(17,80,176)
text(17,72,'На підставі статті ________ графи ______ Розкладу хвороб, Таблиці додаткових вимог',8.3)
line(17,62,176);center(58,'(вказати постанову ВЛК)',7.5)
text(17,50,'Голова ВЛК');line(46,49,147)
center(45,'(військове звання, підпис, власне ім’я та прізвище)',7)
text(17,39,'Члени ВЛК');line(44,38,149)
line(17,33,176);center(29,'(військове звання, підпис, власне ім’я та прізвище)',7)
text(17,23,'Секретар ВЛК');line(51,22,142)
center(18,'(військове звання, підпис, власне ім’я та прізвище)',7)
text(156,10,'М. П.',8)
text(17,10,'«_____» __________________ 20____ року',8)
c.save()
print(OUT)
