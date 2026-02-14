script_name('Arizona Helper')
script_author('UI Refactor Spec')

local imgui = require('mimgui')
local ffi = require('ffi')
local encoding = require('encoding')
encoding.default = 'CP1251'
u8 = encoding.UTF8

local new = imgui.new
local ImVec2 = imgui.ImVec2
local ImVec4 = imgui.ImVec4
local ImGuiCond = imgui.Cond
local ImGuiCol = imgui.Col
local ImGuiStyleVar = imgui.StyleVar
local ImGuiWindowFlags = imgui.WindowFlags

local settings = {
    general = {
        custom_dpi = 1.0,
        accent = ImVec4(0.35, 0.58, 0.95, 1.00)
    }
}

local state = {
    show = new.bool(false),
    active_tab = 1,
    target_tab = 1,
    window_anim = 0.0,
    tab_anim = 1.0,
    search = new.char[128](),
    commands = {
        '/time', '/id', '/gps', '/help', '/report', '/relog', '/stats', '/leaders'
    },
    favorites = {},
    history = {},
    hover_cache = {},
    toasts = {}
}

local TAB_ICONS = {
    [1] = u8'⚙',
    [2] = u8'★',
    [3] = u8'🕘'
}

local TAB_NAMES = {
    [1] = u8'Команды',
    [2] = u8'Избранное',
    [3] = u8'История'
}

local function clamp(v, min_v, max_v)
    if v < min_v then return min_v end
    if v > max_v then return max_v end
    return v
end

local function lerp(a, b, t)
    return a + (b - a) * t
end

local function smooth(current, target, dt, speed)
    local factor = clamp(dt * speed, 0.0, 1.0)
    return lerp(current, target, factor)
end

local function dpi(value)
    local scale = settings.general.custom_dpi
    return value * scale
end

local function add_history(text)
    state.history[#state.history + 1] = os.date('%H:%M:%S') .. ' • ' .. text
    if #state.history > 40 then
        table.remove(state.history, 1)
    end
end

local function add_toast(text)
    state.toasts[#state.toasts + 1] = {
        text = text,
        life = 2.4,
        age = 0.0,
        alpha = 0.0
    }
end

local function push_style()
    imgui.PushStyleVar(ImGuiStyleVar.WindowRounding, dpi(12))
    imgui.PushStyleVar(ImGuiStyleVar.FrameRounding, dpi(10))
    imgui.PushStyleVar(ImGuiStyleVar.GrabRounding, dpi(10))
    imgui.PushStyleVar(ImGuiStyleVar.ScrollbarRounding, dpi(10))
    imgui.PushStyleVar(ImGuiStyleVar.WindowPadding, ImVec2(dpi(12), dpi(10)))
    imgui.PushStyleVar(ImGuiStyleVar.FramePadding, ImVec2(dpi(10), dpi(6)))
    imgui.PushStyleVar(ImGuiStyleVar.ItemSpacing, ImVec2(dpi(10), dpi(8)))

    imgui.PushStyleColor(ImGuiCol.WindowBg, ImVec4(0.08, 0.09, 0.10, 0.96))
    imgui.PushStyleColor(ImGuiCol.ChildBg, ImVec4(0.11, 0.12, 0.14, 0.95))
    imgui.PushStyleColor(ImGuiCol.Button, ImVec4(0.16, 0.17, 0.20, 1.00))
    imgui.PushStyleColor(ImGuiCol.ButtonHovered, ImVec4(0.20, 0.21, 0.26, 1.00))
    imgui.PushStyleColor(ImGuiCol.ButtonActive, ImVec4(0.25, 0.27, 0.31, 1.00))
    imgui.PushStyleColor(ImGuiCol.Header, ImVec4(0.15, 0.16, 0.20, 1.00))
    imgui.PushStyleColor(ImGuiCol.HeaderHovered, ImVec4(0.18, 0.19, 0.24, 1.00))
    imgui.PushStyleColor(ImGuiCol.HeaderActive, ImVec4(0.21, 0.23, 0.28, 1.00))
end

local function pop_style()
    imgui.PopStyleColor(8)
    imgui.PopStyleVar(7)
end

function SectionTitle(icon, text)
    imgui.TextColored(settings.general.accent, u8(icon .. ' ' .. text))
    imgui.Separator()
end

function PrimaryButton(id, text, size)
    imgui.PushStyleColor(ImGuiCol.Button, settings.general.accent)
    imgui.PushStyleColor(ImGuiCol.ButtonHovered, ImVec4(settings.general.accent.x + 0.08, settings.general.accent.y + 0.08, settings.general.accent.z + 0.08, 1.0))
    imgui.PushStyleColor(ImGuiCol.ButtonActive, ImVec4(settings.general.accent.x - 0.05, settings.general.accent.y - 0.05, settings.general.accent.z - 0.05, 1.0))
    local clicked = imgui.Button(u8(text .. '##' .. id), size or ImVec2(0, dpi(32)))
    imgui.PopStyleColor(3)
    return clicked
end

function DrawCard(id, title, draw_fn)
    local dt = imgui.GetIO().DeltaTime
    state.hover_cache[id] = state.hover_cache[id] or { hover = 0.0 }
    local cache = state.hover_cache[id]

    local cursor_y = imgui.GetCursorPosY()
    local was_hovered = imgui.IsWindowHovered()

    local brightness = lerp(0.0, 0.08, cache.hover)
    local base = 0.11 + brightness
    imgui.PushStyleColor(ImGuiCol.ChildBg, ImVec4(base, base + 0.01, base + 0.03, 0.98))

    if imgui.BeginChild(u8('card_' .. id), ImVec2(0, dpi(120)), true) then
        SectionTitle('▌', title)
        draw_fn()
    end

    local hovered = imgui.IsWindowHovered()
    cache.hover = smooth(cache.hover, hovered and 1.0 or 0.0, dt, 10.0)
    imgui.EndChild()
    imgui.PopStyleColor(1)

    if hovered or was_hovered then
        local y_offset = lerp(0.0, -dpi(2), cache.hover)
        imgui.SetCursorPosY(cursor_y + y_offset)
    end
end

local function draw_toasts()
    local dt = imgui.GetIO().DeltaTime
    local vp = imgui.GetMainViewport()
    local right = vp.WorkPos.x + vp.WorkSize.x - dpi(12)
    local top = vp.WorkPos.y + dpi(12)
    local offset_y = 0.0

    for i = #state.toasts, 1, -1 do
        local t = state.toasts[i]
        t.age = t.age + dt
        if t.age < 0.2 then
            t.alpha = smooth(t.alpha, 1.0, dt, 18.0)
        elseif t.age > (t.life - 0.3) then
            t.alpha = smooth(t.alpha, 0.0, dt, 12.0)
        else
            t.alpha = 1.0
        end

        if t.age > t.life then
            table.remove(state.toasts, i)
        else
            imgui.SetNextWindowBgAlpha(0.88 * t.alpha)
            imgui.SetNextWindowPos(ImVec2(right, top + offset_y), ImGuiCond.Always, ImVec2(1.0, 0.0))
            imgui.Begin(u8('toast_' .. i), nil, ImGuiWindowFlags.NoDecoration + ImGuiWindowFlags.AlwaysAutoResize + ImGuiWindowFlags.NoInputs)
            imgui.Text(u8(t.text))
            imgui.End()
            offset_y = offset_y + dpi(36)
        end
    end
end

local function match_search(str)
    local q = ffi.string(state.search)
    if q == '' then return true end
    return string.find(string.lower(str), string.lower(q), 1, true) ~= nil
end

local function toggle_favorite(cmd)
    state.favorites[cmd] = not state.favorites[cmd]
    add_history((state.favorites[cmd] and u8'Добавлено в избранное: ' or u8'Убрано из избранного: ') .. cmd)
    add_toast(u8'Обновлено избранное')
end

local function draw_commands_tab()
    imgui.InputTextWithHint(u8'##search_commands', u8'Поиск команд...', state.search, 128)
    DrawCard('commands_list', u8'Список команд', function()
        for i = 1, #state.commands do
            local cmd = state.commands[i]
            if match_search(cmd) then
                imgui.Text(cmd)
                imgui.SameLine()
                if imgui.SmallButton(u8((state.favorites[cmd] and '★' or '☆') .. '##fav_' .. i)) then
                    toggle_favorite(cmd)
                end
                imgui.SameLine()
                if PrimaryButton('run_' .. i, u8'Выполнить', ImVec2(dpi(120), dpi(28))) then
                    add_history(u8'Выполнена команда: ' .. cmd)
                    add_toast(u8'Команда отправлена: ' .. cmd)
                end
                if imgui.IsItemHovered() then
                    imgui.SetTooltip(u8'Безопасное QoL-действие')
                end
            end
        end
    end)
end

local function draw_favorites_tab()
    DrawCard('favorites', u8'Избранные команды', function()
        local empty = true
        for cmd, fav in pairs(state.favorites) do
            if fav then
                empty = false
                imgui.Text(cmd)
                imgui.SameLine()
                if PrimaryButton('fav_exec_' .. cmd, u8'Выполнить', ImVec2(dpi(120), dpi(28))) then
                    add_history(u8'Из избранного: ' .. cmd)
                    add_toast(u8'Выполнено из избранного')
                end
            end
        end
        if empty then
            imgui.TextDisabled(u8'Пока пусто — добавьте команды из вкладки "Команды".')
        end
    end)
end

local function draw_history_tab()
    DrawCard('history', u8'История действий', function()
        for i = #state.history, 1, -1 do
            imgui.BulletText(u8(state.history[i]))
        end
        if #state.history == 0 then
            imgui.TextDisabled(u8'История пуста.')
        end
    end)
end

local function draw_tab_content()
    local dt = imgui.GetIO().DeltaTime

    if state.target_tab ~= state.active_tab then
        state.tab_anim = smooth(state.tab_anim, 0.0, dt, 8.0)
        if state.tab_anim <= 0.05 then
            state.active_tab = state.target_tab
        end
    else
        state.tab_anim = smooth(state.tab_anim, 1.0, dt, 8.0)
    end

    imgui.PushStyleVar(ImGuiStyleVar.Alpha, state.tab_anim)
    if state.active_tab == 1 then
        draw_commands_tab()
    elseif state.active_tab == 2 then
        draw_favorites_tab()
    else
        draw_history_tab()
    end
    imgui.PopStyleVar(1)
end

imgui.OnFrame(function()
    if not state.show[0] and #state.toasts == 0 then return end

    push_style()

    local dt = imgui.GetIO().DeltaTime
    state.window_anim = smooth(state.window_anim, state.show[0] and 1.0 or 0.0, dt, 10.0)

    if state.window_anim > 0.01 then
        local vp = imgui.GetMainViewport()
        local center_x = vp.WorkPos.x + vp.WorkSize.x * 0.5
        local center_y = vp.WorkPos.y + vp.WorkSize.y * 0.5
        local slide_y = lerp(dpi(16), 0.0, state.window_anim)

        imgui.SetNextWindowBgAlpha(0.96 * state.window_anim)
        imgui.SetNextWindowPos(ImVec2(center_x, center_y + slide_y), ImGuiCond.Always, ImVec2(0.5, 0.5))
        imgui.SetNextWindowSize(ImVec2(dpi(620), dpi(470)), ImGuiCond.FirstUseEver)

        if imgui.Begin(u8'Arizona Helper##main_window', state.show, ImGuiWindowFlags.NoCollapse) then
            SectionTitle('◉', u8'Arizona Helper')

            for i = 1, #TAB_NAMES do
                if i > 1 then imgui.SameLine() end
                local selected = (state.target_tab == i)
                if selected then
                    imgui.PushStyleColor(ImGuiCol.Button, settings.general.accent)
                end

                if imgui.Button(u8(TAB_ICONS[i] .. ' ' .. TAB_NAMES[i] .. '##tab_' .. i), ImVec2(dpi(180), dpi(32))) then
                    state.target_tab = i
                end

                if selected then
                    imgui.PopStyleColor(1)
                end
            end

            draw_tab_content()
        end
        imgui.End()
    end

    draw_toasts()
    pop_style()
end)

function main()
    while not isSampAvailable() do wait(200) end
    add_toast(u8'Arizona Helper загружен')
    state.show[0] = true

    while true do
        wait(0)
        if wasKeyPressed(0x77) then -- F8
            state.show[0] = not state.show[0]
            add_toast(state.show[0] and u8'Окно открыто' or u8'Окно скрыто')
        end
    end
end
