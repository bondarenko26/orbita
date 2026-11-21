// Курс, группа, дисциплины и аудитории взяты из двух таблиц расписания.
// Все имена для демонстрации вымышлены.
const lesson = (slot, parity, subject, kind, room, teacher, extra = {}) =>
  ({slot, parity, subject, kind, room, teacher, ...extra});
const odd = 'odd', even = 'even', both = 'all';
const lecture = 'Лекция', practice = 'Практика', lab = 'Лабораторная';
const sport = 'Физическая культура и спорт (элективная дисциплина)';
const mechanics = 'Техническая механика', drawing = 'Архитектурный рисунок и графика';
const composition = 'Композиционное моделирование', design = 'Методология проектирования';
const sustainability = 'Вопросы устойчивого развития', cities = 'История градостроительства';
const architecture = 'Всеобщая история архитектуры и строительной техники';
const english = 'Иностранный язык (английский)', math = 'Высшая математика';
const geometry = 'Начертательная геометрия, инженерная и компьютерная графика';
const state = 'Основы российской государственности';

export const slots = [
  ['08:30','09:50'], ['10:00','11:20'], ['11:30','12:50'],
  ['13:00','14:20'], ['14:30','15:50'], ['16:00','17:20']
];

export const groups = [
  {
    name: '2-52', course: 2, program_id: 'iag__full_time__bachelor__07_03_01__program_1',
    teachers: {
      sport: 'Борис Борисович Физкультурович', art: 'Алла Алловна Штриховична',
      mechanics: 'Михаил Михайлович Механикович', design: 'Пётр Петрович Проектирович',
      computing: 'Кирилл Кириллович Алгоритмович', sustainability: 'Вера Веровна Ресурсовна',
      computingLecture: 'Инна Инновна Информатиковна', cities: 'Лев Львович Градостроевич',
      history: 'Злата Златовна Архитектуровна', geo: 'Егор Егорович Геодезиевич',
      sustainabilityLecture: 'Лада Ладовна Устойчивовна'
    },
    days: [
      [
        lesson(1,odd,'Модуль 2',practice,'СОК','sport',{weeks:[1,3]}),
        lesson(1,odd,'Модуль 1',practice,'СОК','sport',{fromWeek:5}),
        lesson(2,both,sport,practice,'СОК','sport'),
        lesson(4,both,drawing,practice,'61 НТБ','art'),
        lesson(5,both,drawing,practice,'61 НТБ','art'),
        lesson(6,even,mechanics,lecture,'103 КПА','mechanics')
      ], [
        lesson(3,odd,composition,practice,'418 Г / УЛБ','design'),
        lesson(3,even,design,practice,'633 КМК','design'),
        lesson(4,odd,'КРП · '+composition,practice,'418 Г / УЛБ','design'),
        lesson(4,even,'КРП · '+design,practice,'633 КМК','design'),
        lesson(5,odd,mechanics,practice,'628 КМК','mechanics')
      ], [
        lesson(1,odd,'КОП · Информатика',practice,'210 УЛК','computing'),
        lesson(2,odd,sustainability,practice,'119 УЛК','sustainability'),
        lesson(3,even,mechanics,practice,'721 КМК','mechanics'),
        lesson(4,odd,'Информатика',lecture,'106 КПА','computingLecture'),
        lesson(5,odd,cities,lecture,'104 КПА','cities'),
        lesson(5,even,sustainability,practice,'721 КМК','sustainability'),
        lesson(6,even,architecture,lecture,'109 КПА','history')
      ], [
        lesson(3,odd,design,practice,'629 КМК','design'),
        lesson(3,even,'Геодезия',lab,'334 КМК','geo'),
        lesson(4,odd,design,practice,'629 КМК','design'),
        lesson(4,even,composition,practice,'419 Г / УЛБ','design'),
        lesson(5,odd,mechanics,lecture,'109 КПА','mechanics'),
        lesson(5,even,sustainability,lecture,'104 КПА','sustainabilityLecture'),
        lesson(6,odd,architecture,lecture,'109 КПА','history')
      ], [
        lesson(3,even,'Модуль 1',lecture,'204 Б / УЛБ','sport'),
        lesson(5,odd,'КОП · Информатика',practice,'605 Г / УЛБ','computing'),
        lesson(5,even,cities,lecture,'107 КПА','cities'),
        lesson(6,odd,'Геодезия',lecture,'109 КПА','geo'),
        lesson(6,even,'КОП · Информатика',practice,'312 КМК','computing')
      ]
    ]
  }, {
    name: '1-40', course: 1, program_id: 'iiesm__full_time__specialist__23_05_01__program_1',
    teachers: {
      physics: 'Фёдор Фёдорович Физикович', english: 'Эмма Эммовна Англиевна',
      lab: 'Арсен Арсенович Квантович', chemistry: 'Харитон Харитонович Химикович',
      ecology: 'Марья Марьевна Экологиевична', sport: 'Антон Антонович Спортович',
      history: 'Анна Анновна Летописовна', geometry: 'Глеб Глебович Геометриевич',
      math: 'Иван Иванович Математикович', state: 'Илья Ильич Государствоведович'
    },
    days: [
      [
        lesson(1,odd,'Физика',practice,'443 КМК','physics'),
        lesson(2,odd,english,practice,'702 КМК','english'),
        lesson(3,odd,'Физика',lab,'442 КМК','lab',{subgroup:'1'}),
        lesson(3,even,'Химия',practice,'739 КМК','chemistry'),
        lesson(4,even,'Экология',lecture,'511 Г / УЛБ','ecology')
      ], [
        lesson(3,both,sport,practice,'СОК','sport'),
        lesson(5,both,'История России',lecture,'203 Б / УЛБ','history'),
        lesson(6,both,'Физическая культура и спорт',lecture,'205 Б / УЛБ','sport')
      ], [
        lesson(1,odd,'Экология',practice,'527 КМК','ecology'),
        lesson(2,odd,geometry,practice,'532 КМК','geometry'),
        lesson(4,odd,math,practice,'502 КМК','math'),
        lesson(4,even,english,practice,'702 КМК','english'),
        lesson(5,odd,english,practice,'702 КМК','english'),
        lesson(5,even,math,practice,'502 КМК','math'),
        lesson(6,even,'История России',practice,'522 КМК','history',{weeks:[2,6,10,14]})
      ], [
        lesson(2,odd,'Физика',lecture,'511 Г / УЛБ','physics'),
        lesson(2,even,'Физика',lab,'442 КМК','lab',{subgroup:'2'}),
        lesson(4,both,state,lecture,'204 Б / УЛБ','state'),
        lesson(5,odd,math,practice,'529 КМК','math'),
        lesson(5,even,geometry,practice,'532 КМК','geometry'),
        lesson(6,odd,state,practice,'526 КМК','state',{fromWeek:7}),
        lesson(6,even,state,practice,'522 КМК','state',{fromWeek:6})
      ], [
        lesson(1,even,'Химия',lab,'738 КМК','chemistry',{subgroup:'1'}),
        lesson(2,even,english,practice,'702 КМК','english'),
        lesson(3,odd,'Химия',lab,'737 КМК','chemistry',{subgroup:'2'}),
        lesson(4,odd,'Химия',lecture,'420 Г / УЛБ','chemistry'),
        lesson(4,even,geometry,lecture,'511 Г / УЛБ','geometry'),
        lesson(5,both,math,lecture,'104 КПА','math')
      ]
    ]
  }
];
